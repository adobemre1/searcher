import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// dotenv must load before config reads process.env (HOST/PORT/JOURNAL_ENABLED)
dotenv.config({ path: ['.env.local', '.env'] });

const { HOST, PORT, ACCOUNTS, INDEX_DIR, shardFileName } = await import('./config.js');
const {
  getTokenForAccount,
  getRateLimits,
  logSafe,
} = await import('./github.js');
const {
  globalSyncStatus,
  globalRepoRegistry,
  loadRepoRegistry,
  checkStaleness,
  runFullSync,
  syncSingleExternal,
  ensureDirs
} = await import('./sync.js');
const { listExternal, addExternal, removeExternal, normalizeRepoId } = await import('./external.js');
const {
  searchMirror,
  loadIndexIntoMemory,
  getMemoryIndex,
  reloadIndex
} = await import('./searchIndex.js');
const {
  executeLocalSemanticSearch,
  buildLocalExplanation
} = await import('./semanticSearch.js');
const { searchLiveOnGitHub } = await import('./liveSearch.js');
const { foldTurkish } = await import('./fold.js');
const { maskSecrets } = await import('./mask.js');
const {
  initJournal,
  recordSearch,
  getRecentEntries,
  getWordAggregates,
  getJournalHealth,
  clearJournal,
  buildExport
} = await import('./journal.js');
const { getSystemMetrics } = await import('./system.js');

const app = express();
app.use(express.json());

// Load in-memory components on startup
ensureDirs();
loadRepoRegistry();
loadIndexIntoMemory();
initJournal();

// Async staleness review (skipped automatically when no tokens are configured)
checkStaleness().then(() => {
  logSafe('Startup staleness review completed.');
}).catch(err => {
  logSafe(`Failed initial staleness check: ${err.message}`);
});

/**
 * CSRF guard for mutating endpoints: cross-origin pages cannot set custom
 * headers (form posts can't at all; fetch triggers a CORS preflight this
 * server never allows), so requiring one blocks drive-by requests while
 * keeping same-origin app calls trivial.
 */
function requireIntentHeader(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.get('x-ecysearch') === '1') {
    return next();
  }
  return res.status(403).json({ error: 'local requests only' });
}

// ==========================================
// API ROUTES
// ==========================================

app.get('/api/health', (req, res) => {
  const accountsAuthedCount = ACCOUNTS.filter(a => getTokenForAccount(a.login) !== null).length;
  res.json({
    ok: true,
    version: '1.1.0',
    node: process.version,
    uptimeSec: Math.floor(process.uptime()),
    mode: accountsAuthedCount > 0 ? 'authed' : 'demo'
  });
});

app.get('/api/accounts', async (req, res) => {
  try {
    const results = await Promise.all(
      ACCOUNTS.map(async (acc) => {
        const tokenVal = getTokenForAccount(acc.login);
        const hasToken = tokenVal !== null;
        let verifiedLogin = acc.login;
        let publicReposCount = 0;
        let authStateValid = false;

        if (hasToken) {
          try {
            const { githubFetch } = await import('./github.js');
            const verifiedRes = await githubFetch(acc.login, '/user', { useETag: false });
            if (verifiedRes.status === 200 && verifiedRes.body) {
              verifiedLogin = verifiedRes.body.login;
              publicReposCount = verifiedRes.body.public_repos || 0;
              authStateValid = true;
            }
          } catch {
            authStateValid = false;
          }
        }

        return {
          login: acc.login,
          hasToken,
          verifiedLogin,
          public_repos: publicReposCount,
          verified: authStateValid
        };
      })
    );

    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/repos', (req, res) => {
  const reposList = Object.entries(globalRepoRegistry).map(([key, value]) => ({
    id: key,
    ...value
  }));
  res.json(reposList);
});

app.post('/api/repos/delete', requireIntentHeader, async (req, res) => {
  const repoId = req.body.id as string; // 'owner/repo'
  if (!repoId || !repoId.includes('/')) {
    return res.status(400).json({ error: 'Repository ID in format "owner/repo" is required.' });
  }

  try {
    const [owner, name] = repoId.split('/');
    const shardPath = path.join(INDEX_DIR, shardFileName(owner, name));
    if (fs.existsSync(shardPath)) fs.unlinkSync(shardPath);

    delete globalRepoRegistry[repoId];
    if (globalSyncStatus.repos[repoId]) {
      delete globalSyncStatus.repos[repoId];
    }

    reloadIndex();

    res.json({ ok: true, message: `Index shard(s) for ${repoId} removed.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to remove repository cache.' });
  }
});

app.post('/api/sync', requireIntentHeader, (req, res) => {
  if (globalSyncStatus.active) {
    return res.status(409).json({ error: 'Sync already in progress (concurrency lock active).' });
  }

  const force = req.body.force === true;

  runFullSync({ force }).catch(err => {
    console.error('Sync runner error:', err);
  });

  res.json({ ok: true, message: 'Sync started.' });
});

app.get('/api/sync/status', (req, res) => {
  res.json(globalSyncStatus);
});

/**
 * Search dispatcher. Journaling intentionally does NOT happen here — the
 * frontend records committed searches via POST /api/journal/record, so the
 * search hot path never touches the disk.
 */
app.get('/api/search', async (req, res) => {
  const q = (req.query.q as string || '').trim();
  const mode = req.query.mode as string || 'mirror';
  const regex = req.query.regex === 'true';
  const word = req.query.word === 'true';
  const caseSensitive = req.query.caseSensitive === 'true';
  const fold = req.query.fold !== 'false'; // TR fold on by default

  const accounts = req.query.accounts ? (req.query.accounts as string).split(',') : undefined;
  const repos = req.query.repos ? (req.query.repos as string).split(',') : undefined;
  const pathQuery = req.query.path as string || undefined;
  const ext = req.query.ext as string || undefined;
  const limitVal = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

  // Semantic tuning coefficients from the Engine Calibration panel
  const similarityThreshold = req.query.similarityThreshold ? parseFloat(req.query.similarityThreshold as string) : undefined;
  const pathBoost = req.query.pathBoost ? parseFloat(req.query.pathBoost as string) : undefined;
  const k1 = req.query.k1 ? parseFloat(req.query.k1 as string) : undefined;
  const b = req.query.b ? parseFloat(req.query.b as string) : undefined;
  const maxLineLength = req.query.maxLineLength ? parseInt(req.query.maxLineLength as string, 10) : undefined;

  if (!q) {
    return res.status(400).json({ error: 'Search query parameter (q) is required.' });
  }

  try {
    if (mode === 'live') {
      const scope = req.query.scope === 'global' ? 'global' : 'configured';
      const page = req.query.page ? Math.max(1, parseInt(req.query.page as string, 10) || 1) : 1;
      const liveResult = await searchLiveOnGitHub({
        q,
        accounts,
        repos,
        limit: limitVal || 50,
        scope,
        page
      });
      return res.json(liveResult);
    }

    if (mode === 'semantic') {
      const memoryIndex = getMemoryIndex();
      const semResult = executeLocalSemanticSearch(memoryIndex, {
        q,
        accounts,
        repos,
        limit: limitVal || 40,
        similarityThreshold,
        pathBoost,
        k1,
        b,
        maxLineLength
      });

      const mappedResults = semResult.results.flatMap(sm =>
        sm.matchedLines.map(lineMat => ({
          owner: sm.owner,
          repo: sm.repo,
          path: sm.path,
          line: lineMat.text,
          lineNumber: lineMat.lineNumber,
          before: null,
          after: null,
          matchRanges: lineMat.matchRanges.length > 0
            ? lineMat.matchRanges
            : [{ start: 0, length: lineMat.text.length }]
        }))
      );

      return res.json({
        results: mappedResults,
        pathMatches: semResult.results.slice(0, 8).map(r => ({ owner: r.owner, repo: r.repo, path: r.path })),
        totalFound: semResult.results.length,
        truncated: false,
        tookMs: semResult.tookMs,
        apiCallsUsed: 0,
        explanation: buildLocalExplanation(q, semResult.results)
      });
    }

    const mirrorResult = await searchMirror({
      q,
      regex,
      word,
      caseSensitive,
      fold,
      accounts,
      repos,
      pathQuery,
      ext,
      limit: limitVal || 500
    });
    return res.json(mirrorResult);
  } catch (err: any) {
    const msg = err?.message || 'Search execution failed.';
    if (msg.includes('too slow') || msg.includes('timeout') || msg.includes('too long') || msg.includes('Invalid search regex')) {
      return res.status(422).json({ error: msg });
    }
    return res.status(500).json({ error: msg });
  }
});

app.get('/api/ratelimit', async (req, res) => {
  try {
    const limits: Record<string, any> = {};
    for (const acc of ACCOUNTS) {
      const hasToken = getTokenForAccount(acc.login) !== null;
      limits[acc.login] = hasToken ? await getRateLimits(acc.login) : null;
    }
    res.json(limits);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// EXTERNAL REPOS — search any GitHub repo beyond your own accounts
// ==========================================

app.get('/api/external', (req, res) => {
  res.json(listExternal());
});

app.post('/api/external/add', requireIntentHeader, async (req, res) => {
  const repoId = normalizeRepoId(String(req.body?.repo || ''));
  if (!repoId) {
    return res.status(400).json({ error: 'Expected "owner/repo" (or a github.com URL).' });
  }
  if (globalSyncStatus.active) {
    // Persist now; the running sync (or the next one) will index it.
    await addExternal(repoId);
    return res.status(202).json({ ok: true, repo: repoId, queued: true, message: 'Added; will index after the current sync.' });
  }
  const added = await addExternal(repoId);
  if (!added.ok) {
    return res.status(400).json({ error: added.error || 'Could not add repository.' });
  }
  const synced = await syncSingleExternal(repoId);
  if (!synced.ok) {
    // Keep it tracked (the user can retry sync), but report the reason.
    return res.status(200).json({ ok: true, repo: repoId, indexed: false, warning: synced.error });
  }
  res.json({ ok: true, repo: repoId, indexed: true });
});

app.post('/api/external/remove', requireIntentHeader, async (req, res) => {
  const repoId = String(req.body?.repo || '').trim();
  if (!repoId || !repoId.includes('/')) {
    return res.status(400).json({ error: 'Expected "owner/repo".' });
  }
  await removeExternal(repoId);

  // Drop its shard + registry entry so it disappears from the mirror.
  try {
    const [owner, name] = repoId.split('/');
    const shardPath = path.join(INDEX_DIR, shardFileName(owner, name));
    if (fs.existsSync(shardPath)) fs.unlinkSync(shardPath);
    delete globalRepoRegistry[repoId];
    if (globalSyncStatus.repos[repoId]) delete globalSyncStatus.repos[repoId];
    reloadIndex();
  } catch (err: any) {
    return res.status(200).json({ ok: true, repo: repoId, warning: err?.message });
  }

  res.json({ ok: true, repo: repoId });
});

// ==========================================
// JOURNAL — the found-words notebook
// ==========================================

app.post('/api/journal/record', requireIntentHeader, (req, res) => {
  const body = req.body || {};
  const outcome = recordSearch({
    q: String(body.q || ''),
    mode: body.mode === 'live' || body.mode === 'semantic' ? body.mode : 'mirror',
    flags: {
      regex: !!body.flags?.regex,
      word: !!body.flags?.word,
      caseSensitive: !!body.flags?.caseSensitive,
      fold: body.flags?.fold !== false
    },
    filters: {
      accounts: Array.isArray(body.filters?.accounts) ? body.filters.accounts : undefined,
      repos: Array.isArray(body.filters?.repos) ? body.filters.repos : undefined,
      path: body.filters?.path || undefined,
      ext: body.filters?.ext || undefined
    },
    totalFound: Number(body.totalFound) || 0,
    tookMs: Number(body.tookMs) || 0,
    apiCallsUsed: Number(body.apiCallsUsed) || 0
  });
  res.json(outcome);
});

app.get('/api/journal', (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 200;
  res.json(getRecentEntries(limit));
});

app.get('/api/journal/words', (req, res) => {
  res.json(getWordAggregates());
});

app.delete('/api/journal', requireIntentHeader, async (req, res) => {
  await clearJournal();
  res.json({ ok: true, message: 'Journal cleared (words and entries).' });
});

app.get('/api/journal/export', async (req, res) => {
  const format = req.query.format === 'json' ? 'json' : 'md';
  try {
    const out = await buildExport(format);
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.status(200).send(out.body);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Export failed' });
  }
});

// ==========================================
// SYSTEM — measured metrics only
// ==========================================

app.get('/api/system', (req, res) => {
  res.json(getSystemMetrics());
});

// ==========================================
// DOCTOR — every message derives from its actual check result
// ==========================================

app.get('/api/doctor', async (req, res) => {
  const diagnostics: Array<{ title: string; status: 'pass' | 'fail'; message: string }> = [];

  diagnostics.push({
    title: 'Server health',
    status: 'pass',
    message: `Express responsive on ${HOST}:${PORT} (Node ${process.version}).`
  });

  const hasIndexDir = fs.existsSync(INDEX_DIR);
  const fileShards = hasIndexDir ? fs.readdirSync(INDEX_DIR).filter(f => f.endsWith('.json.gz')) : [];
  diagnostics.push({
    title: 'Index cache',
    status: hasIndexDir ? 'pass' : 'fail',
    message: hasIndexDir
      ? `${fileShards.length} compressed shard(s) under .cache/index.`
      : 'Cache directory missing — run a sync.'
  });

  const valFold1 = foldTurkish('Danışman');
  const valFold2 = foldTurkish('DANIŞMAN');
  const passesTRFold = valFold1 === 'danisman' && valFold2 === 'danisman';
  diagnostics.push({
    title: 'Turkish fold',
    status: passesTRFold ? 'pass' : 'fail',
    message: passesTRFold
      ? `"Danışman" and "DANIŞMAN" both fold to "danisman".`
      : `Fold mismatch: got "${valFold1}" / "${valFold2}", expected "danisman".`
  });

  // Token-shaped fixture is built at runtime — never a literal in source.
  const mockToken = 'ghp_' + Array.from({ length: 36 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  const maskedMockResult = maskSecrets(`line with ${mockToken} inside`);
  const passesSecretMasking = !maskedMockResult.includes(mockToken) && maskedMockResult.includes('•••MASKED•••');
  diagnostics.push({
    title: 'Secret masking',
    status: passesSecretMasking ? 'pass' : 'fail',
    message: passesSecretMasking
      ? 'Runtime-built token fixture was masked in output.'
      : 'Masking failed — token fixture leaked through.'
  });

  const authConnectedCount = ACCOUNTS.filter(acc => getTokenForAccount(acc.login)).length;
  diagnostics.push({
    title: 'GitHub auth mode',
    status: authConnectedCount > 0 ? 'pass' : 'fail',
    message: authConnectedCount > 0
      ? `${authConnectedCount} account token(s) loaded.`
      : 'Demo mode (no tokens) — public repos only at 60 req/hr. Add PATs in .env.local.'
  });

  const rssBytes = process.memoryUsage().rss;
  const rssOk = rssBytes < 1.5 * 1024 * 1024 * 1024;
  diagnostics.push({
    title: 'Memory (RSS)',
    status: rssOk ? 'pass' : 'fail',
    message: `${(rssBytes / (1024 * 1024)).toFixed(0)} MB resident${rssOk ? '' : ' — above the 1.5 GB budget'}.`
  });

  const jh = getJournalHealth();
  diagnostics.push({
    title: 'Search journal',
    status: jh.enabled && !jh.breakerTripped ? 'pass' : 'fail',
    message: jh.breakerTripped
      ? 'Circuit breaker tripped after repeated write failures — journaling disabled, search unaffected.'
      : jh.enabled
        ? `${jh.wordCount} word(s), ${jh.entryCount} entrie(s), ${jh.redactedCount} redacted.`
        : 'Disabled via JOURNAL_ENABLED=false.'
  });

  // Regex worker round-trip on a trivially safe pattern.
  try {
    await searchMirror({ q: 'a{0}b', regex: true, word: false, caseSensitive: false, fold: false, limit: 1 });
    diagnostics.push({
      title: 'Regex worker',
      status: 'pass',
      message: 'Worker round-trip completed within the time budget.'
    });
  } catch (err: any) {
    diagnostics.push({
      title: 'Regex worker',
      status: 'fail',
      message: `Worker check failed: ${err?.message}`
    });
  }

  const allPass = diagnostics.every(d => d.status === 'pass');
  res.json({ ok: allPass, diagnostics });
});

// ==========================================
// FRONTEND STATIC / MIDDLEWARE DISPATCHER
// ==========================================

async function setupFrontend() {
  if (process.env.NODE_ENV !== 'production') {
    logSafe('Activating Vite development middleware...');
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      logSafe(`Serving production assets from: ${distPath}`);
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    } else {
      logSafe('Production dist directory not found. Run "npm run build" first.');
      app.get('*', (req, res) => {
        res.status(404).send('Production bundle missing. Run "npm run build".');
      });
    }
  }
}

setupFrontend().then(() => {
  const server = app.listen(PORT, HOST, () => {
    logSafe(`Server online: http://${HOST}:${PORT} (bind host from HOST env, default loopback)`);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is busy. Set PORT in .env.local (e.g. PORT=3020) and retry. Exiting.`);
      process.exit(1);
    }
  });
}).catch(err => {
  console.error('Frontend setup failed:', err);
});
