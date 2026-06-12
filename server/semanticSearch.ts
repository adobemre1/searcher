import { VectorMath } from './vectorMath.js';
import { parseBooleanQuery } from './searchIndex.js';
import { foldTurkish } from './fold.js';
import { maskSecrets } from './mask.js';

export interface IndexedFile {
  owner: string;
  repo: string;
  path: string;
  lines: string[];
  foldedLines: string[];
}

export interface SemanticMatchResult {
  owner: string;
  repo: string;
  path: string;
  score: number;
  matchedLines: Array<{
    lineNumber: number;
    text: string;
    score: number;
    matchRanges: Array<{ start: number; length: number }>;
  }>;
}

export interface SemanticSearchResponse {
  results: SemanticMatchResult[];
  tookMs: number;
  totalFound: number;
  explanation?: string;
}

// Common codebase programming stopwords list
const CODE_STOPWORDS = new Set([
  'const', 'let', 'var', 'function', 'import', 'from', 'return', 'class',
  'public', 'private', 'interface', 'export', 'default', 'this', 'false',
  'true', 'null', 'undefined', 'async', 'await', 'package',
  'string', 'number', 'boolean', 'void', 'new', 'require', 'module'
]);

function tokenize(text: string): string[] {
  const folded = foldTurkish(text).toLowerCase();
  return folded.split(/[^a-z0-9_]+/).filter(t => t.length > 2);
}

/**
 * Local relevance search over the in-memory index: BM25-saturated term counts
 * scored by cosine similarity against the query vector. Entirely offline —
 * zero network calls, zero LLM tokens, by design.
 */
export function executeLocalSemanticSearch(
  memoryIndex: IndexedFile[],
  params: {
    q: string;
    accounts?: string[];
    repos?: string[];
    limit?: number;
    similarityThreshold?: number;
    pathBoost?: number;
    k1?: number; // BM25 term frequency saturation coefficient
    b?: number;  // BM25 document length normalization coefficient
    maxLineLength?: number;
  }
): { results: SemanticMatchResult[]; tookMs: number } {
  const startTime = Date.now();
  const limit = params.limit || 30;

  const k1 = params.k1 !== undefined ? params.k1 : 1.2;
  const bMultiplier = params.b !== undefined ? params.b : 0.75;
  const pathBoostFactor = params.pathBoost !== undefined ? params.pathBoost : 0.25;
  const simThreshold = params.similarityThreshold !== undefined ? params.similarityThreshold : 0.1;
  const maxLineLength = params.maxLineLength !== undefined ? params.maxLineLength : 350;

  const query = params.q;
  const parsed = parseBooleanQuery(query, true, false);
  const qTokens = [...parsed.positiveTerms, ...parsed.exactPhrases];

  if (qTokens.length === 0) {
    return { results: [], tookMs: Date.now() - startTime };
  }

  const accountFilter = params.accounts && params.accounts.length > 0 ? new Set(params.accounts) : null;
  const repoFilter = params.repos && params.repos.length > 0 ? new Set(params.repos) : null;

  const hasNonStopwords = qTokens.some(tok => !CODE_STOPWORDS.has(tok));

  // Query vector with stopword de-prioritization
  const queryCounts: Record<string, number> = {};
  for (const tok of qTokens) {
    let weight = 1.0;
    if (hasNonStopwords && CODE_STOPWORDS.has(tok)) {
      weight = 0.25;
    }
    queryCounts[tok] = (queryCounts[tok] || 0) + weight;
  }
  const uniqueQueryTokens = Object.keys(queryCounts);
  const qVector = uniqueQueryTokens.map(tok => queryCounts[tok]);

  const matches: SemanticMatchResult[] = [];

  for (const file of memoryIndex) {
    const key = `${file.owner}/${file.repo}`;
    if (accountFilter && !accountFilter.has(file.owner)) continue;
    if (repoFilter && !repoFilter.has(key)) continue;

    const fileWordCounts: Record<string, number> = {};
    for (const token of uniqueQueryTokens) {
      fileWordCounts[token] = 0;
    }

    const lineMatches: SemanticMatchResult['matchedLines'] = [];

    const lineCount = file.lines.length;
    for (let i = 0; i < lineCount; i++) {
      const originalLine = file.lines[i];
      // Skip excessively long/minified lines to bound execution time
      if (originalLine.length > maxLineLength) continue;

      const lineStr = file.foldedLines[i];

      let skipLine = false;
      for (const neg of parsed.negativeTerms) {
        if (lineStr.includes(neg)) {
          skipLine = true;
          break;
        }
      }
      if (skipLine) continue;

      let lineHasQueryToken = false;
      const lineWordCounts: Record<string, number> = {};
      const averageLineLength = 60; // expected code line length model

      for (const token of uniqueQueryTokens) {
        if (lineStr.includes(token)) {
          lineHasQueryToken = true;
          const rawCount = (lineStr.split(token).length - 1);

          // BM25 frequency saturation
          const lengthNormalizer = 1.0 - bMultiplier + bMultiplier * (lineStr.length / averageLineLength);
          const saturatedCount = (rawCount * (k1 + 1)) / (rawCount + k1 * lengthNormalizer);

          lineWordCounts[token] = saturatedCount;
          fileWordCounts[token] = (fileWordCounts[token] || 0) + saturatedCount;
        } else {
          lineWordCounts[token] = 0;
        }
      }

      if (lineHasQueryToken) {
        const lVector = uniqueQueryTokens.map(tok => lineWordCounts[tok]);
        try {
          const lScore = VectorMath.cosineSimilarity(qVector, lVector);
          if (lScore > 0.05) {
            // Highlight ranges: every token occurrence on the folded plane
            // (fold is 1:1 per char except the stripped combining dot).
            const matchRanges: Array<{ start: number; length: number }> = [];
            for (const token of uniqueQueryTokens) {
              let idx = lineStr.indexOf(token);
              while (idx !== -1) {
                matchRanges.push({ start: idx, length: token.length });
                idx = lineStr.indexOf(token, idx + token.length);
              }
            }

            lineMatches.push({
              lineNumber: i + 1,
              text: maskSecrets(originalLine),
              score: parseFloat(lScore.toFixed(4)),
              matchRanges
            });
          }
        } catch {
          // zero-length vector guard
        }
      }
    }

    const fVector = uniqueQueryTokens.map(tok => fileWordCounts[tok]);
    let docScore = 0;
    try {
      docScore = VectorMath.cosineSimilarity(qVector, fVector);
    } catch {}

    let pathBoost = 0;
    const pathTokens = tokenize(file.path);
    for (const qtok of uniqueQueryTokens) {
      if (pathTokens.includes(qtok)) {
        pathBoost += pathBoostFactor;
      }
    }

    const finalScore = docScore + pathBoost;

    if (finalScore > simThreshold) {
      lineMatches.sort((a, b) => b.score - a.score);

      matches.push({
        owner: file.owner,
        repo: file.repo,
        path: file.path,
        score: parseFloat(Math.min(finalScore, 1.0).toFixed(4)),
        matchedLines: lineMatches.slice(0, 5)
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  return {
    results: matches.slice(0, limit),
    tookMs: Date.now() - startTime
  };
}

/**
 * Builds a short, honest, fully local summary of the ranking outcome.
 * No LLM involved — every number comes from the scoring pass above.
 */
export function buildLocalExplanation(query: string, results: SemanticMatchResult[]): string {
  if (results.length === 0) {
    return `No file scored above the similarity threshold for "${query}". Try lowering the threshold in Engine Calibration or using Mirror mode for exact substrings.`;
  }
  const top = results[0];
  const repoCount = new Set(results.map(r => `${r.owner}/${r.repo}`)).size;
  return `Local TF-IDF/BM25 ranking (offline, 0 API calls): ${results.length} file(s) across ${repoCount} repo(s) matched "${query}". ` +
    `Top relevance: ${(top.score * 100).toFixed(1)}% — ${top.owner}/${top.repo}/${top.path}.`;
}
