import React, { useState, useEffect, useRef } from 'react';
import {
  getAccounts,
  getRepos,
  getSyncStatus,
  getRateLimits,
  getSystemMetrics,
  recordJournal,
  search,
  AccountInfo,
  RepoInfo,
  SyncStatus,
  RateLimits,
  SearchResponse,
  SystemMetrics,
  JournalEntry
} from './api';

import SearchBar from './components/SearchBar';
import Filters from './components/Filters';
import ResultList from './components/ResultList';
import SyncPanel from './components/SyncPanel';
import StatusBar from './components/StatusBar';
import DemoBanner from './components/DemoBanner';
import DoctorModal from './components/DoctorModal';
import SystemDrawer from './components/SystemDrawer';

export default function App() {
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [rateLimits, setRateLimits] = useState<RateLimits | null>(null);
  const [systemMetrics, setSystemMetrics] = useState<SystemMetrics | null>(null);
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);

  // Filter controllers
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [pathQuery, setPathQuery] = useState('');
  const [extQuery, setExtQuery] = useState('');

  // Persistent semantic Engine Calibration parameters
  const [similarityThreshold, setSimilarityThreshold] = useState<number>(() => {
    const saved = localStorage.getItem('ecysearch_similarityThreshold');
    return saved ? parseFloat(saved) : 0.10;
  });
  const [pathBoost, setPathBoost] = useState<number>(() => {
    const saved = localStorage.getItem('ecysearch_pathBoost');
    return saved ? parseFloat(saved) : 0.25;
  });
  const [k1, setK1] = useState<number>(() => {
    const saved = localStorage.getItem('ecysearch_k1');
    return saved ? parseFloat(saved) : 1.20;
  });
  const [b, setB] = useState<number>(() => {
    const saved = localStorage.getItem('ecysearch_b');
    return saved ? parseFloat(saved) : 0.75;
  });
  const [maxLineLength, setMaxLineLength] = useState<number>(() => {
    const saved = localStorage.getItem('ecysearch_maxLineLength');
    return saved ? parseInt(saved, 10) : 350;
  });

  useEffect(() => {
    localStorage.setItem('ecysearch_similarityThreshold', String(similarityThreshold));
  }, [similarityThreshold]);
  useEffect(() => {
    localStorage.setItem('ecysearch_pathBoost', String(pathBoost));
  }, [pathBoost]);
  useEffect(() => {
    localStorage.setItem('ecysearch_k1', String(k1));
  }, [k1]);
  useEffect(() => {
    localStorage.setItem('ecysearch_b', String(b));
  }, [b]);
  useEffect(() => {
    localStorage.setItem('ecysearch_maxLineLength', String(maxLineLength));
  }, [maxLineLength]);

  // Active inputs
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'mirror' | 'live' | 'semantic'>('mirror');
  const [regex, setRegex] = useState(false);
  const [word, setWord] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [fold, setFold] = useState(true);
  const [liveScope, setLiveScope] = useState<'configured' | 'global'>('configured');

  // Status indicators
  const [isSearching, setIsSearching] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Layout UI states
  const [isSyncPanelOpen, setIsSyncPanelOpen] = useState(false);
  const [isDoctorOpen, setIsDoctorOpen] = useState(false);
  const [isSystemOpen, setIsSystemOpen] = useState(false);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qRef = useRef(q);
  qRef.current = q;
  const [rerunNonce, setRerunNonce] = useState(0);

  const loadWorkspaceData = async () => {
    try {
      const [accs, repositories, rates, sync] = await Promise.all([
        getAccounts(),
        getRepos(),
        getRateLimits(),
        getSyncStatus()
      ]);
      setAccounts(accs);
      setRepos(repositories);
      setRateLimits(rates);
      setSyncStatus(sync);

      if (accs.length > 0 && selectedAccounts.length === 0) {
        setSelectedAccounts(accs.map(a => a.login));
      }
    } catch (err) {
      console.error('Failed to load initial workspace data:', err);
    }
  };

  useEffect(() => {
    loadWorkspaceData();
    getSystemMetrics().then(setSystemMetrics).catch(() => {});

    // Refresh gauges every 15s
    const rateTimer = setInterval(async () => {
      try {
        const [rates, sys] = await Promise.all([getRateLimits(), getSystemMetrics()]);
        setRateLimits(rates);
        setSystemMetrics(sys);
      } catch {}
    }, 15000);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(rateTimer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Poll sync progress while a sync runs
  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    if (syncStatus?.active) {
      pollInterval = setInterval(async () => {
        try {
          const status = await getSyncStatus();
          setSyncStatus(status);

          if (!status.active) {
            const reposList = await getRepos();
            setRepos(reposList);
            const rates = await getRateLimits();
            setRateLimits(rates);
          }
        } catch (err) {
          console.error('Failed to poll sync state:', err);
        }
      }, 1500);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [syncStatus?.active]);

  const buildParams = () => ({
    q,
    mode,
    regex,
    word,
    caseSensitive,
    fold,
    accounts: selectedAccounts,
    repos: selectedRepos,
    path: pathQuery || undefined,
    ext: extQuery || undefined,
    similarityThreshold,
    pathBoost,
    k1,
    b,
    maxLineLength,
    liveScope
  });

  /**
   * Journal a committed search. Fire-and-forget: a journal failure never
   * affects the search UX. The server additionally skips q.length < 3 and
   * secret-shaped queries.
   */
  const journalSearch = (params: ReturnType<typeof buildParams>, res: SearchResponse) => {
    recordJournal({
      q: params.q,
      mode: params.mode,
      flags: {
        regex: params.regex,
        word: params.word,
        caseSensitive: params.caseSensitive,
        fold: params.fold
      },
      filters: {
        accounts: params.accounts,
        repos: params.repos,
        path: params.path,
        ext: params.ext
      },
      totalFound: res.totalFound,
      tookMs: res.tookMs,
      apiCallsUsed: res.apiCallsUsed
    }).catch(() => {});
  };

  /**
   * commit=true → Enter / rerun: record in the journal immediately.
   * commit=false → debounced live typing: only record if the query then sits
   * unchanged for ≥ 1.5 s (the "settled" rule keeps prefix noise out).
   */
  const triggerSearch = async (opts: { commit?: boolean } = {}) => {
    if (!q.trim()) {
      setSearchResponse(null);
      setSearchError(null);
      return;
    }

    const params = buildParams();
    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await search(params);
      setSearchResponse(res);

      if (dwellTimerRef.current) {
        clearTimeout(dwellTimerRef.current);
        dwellTimerRef.current = null;
      }

      if (opts.commit) {
        journalSearch(params, res);
      } else {
        dwellTimerRef.current = setTimeout(() => {
          if (qRef.current === params.q) {
            journalSearch(params, res);
          }
        }, 1500);
      }
    } catch (err: any) {
      setSearchError(err?.message || 'Search execution failed');
      setSearchResponse({
        results: [],
        pathMatches: [],
        totalFound: 0,
        truncated: false,
        tookMs: 0,
        apiCallsUsed: 0
      });
    } finally {
      setIsSearching(false);
    }
  };

  // Debounced auto-search for the free local modes (mirror + semantic).
  // Live mode fires on Enter only to protect the 10 req/min budget.
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    if (mode === 'live') {
      return;
    }

    searchTimerRef.current = setTimeout(() => {
      triggerSearch();
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [q, mode, regex, word, caseSensitive, fold, liveScope, selectedAccounts, selectedRepos, pathQuery, extQuery, similarityThreshold, pathBoost, k1, b, maxLineLength]);

  // Rerun requested from the notebook: state is set first, then the nonce
  // effect fires the search (works for live mode too, which has no debounce).
  useEffect(() => {
    if (rerunNonce > 0) {
      triggerSearch({ commit: true });
    }
  }, [rerunNonce]);

  const handleSelectJournalQuery = (query: string, config?: Partial<Pick<JournalEntry, 'mode' | 'flags' | 'filters'>>) => {
    setQ(query);
    if (config?.mode) setMode(config.mode);
    if (config?.flags) {
      setRegex(!!config.flags.regex);
      setWord(!!config.flags.word);
      setCaseSensitive(!!config.flags.caseSensitive);
      setFold(config.flags.fold !== false);
    }
    if (config?.filters) {
      setPathQuery(config.filters.path || '');
      setExtQuery(config.filters.ext || '');
      if (config.filters.accounts && config.filters.accounts.length > 0) setSelectedAccounts(config.filters.accounts);
      if (config.filters.repos && config.filters.repos.length > 0) setSelectedRepos(config.filters.repos);
    }
    setIsSystemOpen(false);
    setRerunNonce(n => n + 1);
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0F1115] text-[#E3E3E3] font-sans">
      <DemoBanner accounts={accounts} />

      <SearchBar
        q={q}
        setQ={setQ}
        mode={mode}
        setMode={setMode}
        regex={regex}
        setRegex={setRegex}
        word={word}
        setWord={setWord}
        caseSensitive={caseSensitive}
        setCaseSensitive={setCaseSensitive}
        fold={fold}
        setFold={setFold}
        liveScope={liveScope}
        setLiveScope={setLiveScope}
        onSearchTrigger={() => triggerSearch({ commit: true })}
        isSearching={isSearching}
        openDoctor={() => setIsDoctorOpen(true)}
        isSyncing={syncStatus?.active || false}
        toggleSyncPanel={() => setIsSyncPanelOpen(!isSyncPanelOpen)}
        openSystem={() => setIsSystemOpen(true)}
      />

      <div className="flex flex-1 overflow-hidden relative">
        <Filters
          accounts={accounts}
          repos={repos}
          selectedAccounts={selectedAccounts}
          setSelectedAccounts={setSelectedAccounts}
          selectedRepos={selectedRepos}
          setSelectedRepos={setSelectedRepos}
          pathQuery={pathQuery}
          setPathQuery={setPathQuery}
          extQuery={extQuery}
          setExtQuery={setExtQuery}
          similarityThreshold={similarityThreshold}
          setSimilarityThreshold={setSimilarityThreshold}
          pathBoost={pathBoost}
          setPathBoost={setPathBoost}
          k1={k1}
          setK1={setK1}
          b={b}
          setB={setB}
          maxLineLength={maxLineLength}
          setMaxLineLength={setMaxLineLength}
          onExternalChange={loadWorkspaceData}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          {searchError && (
            <div className="bg-red-950/40 border-b border-red-900/50 p-3 text-red-400 font-mono text-xs flex justify-between items-center shrink-0 leading-relaxed select-text">
              <span><strong>Search Error:</strong> {searchError}</span>
              <button onClick={() => setSearchError(null)} className="text-gray-500 hover:text-white px-1 font-sans">✕</button>
            </div>
          )}

          <ResultList response={searchResponse} isSearching={isSearching} q={q} />
        </div>

        <SyncPanel
          status={syncStatus}
          cachedRepos={repos}
          onRefresh={loadWorkspaceData}
          isOpen={isSyncPanelOpen}
          onClose={() => setIsSyncPanelOpen(false)}
        />
      </div>

      <DoctorModal isOpen={isDoctorOpen} onClose={() => setIsDoctorOpen(false)} />

      <SystemDrawer
        isOpen={isSystemOpen}
        onClose={() => setIsSystemOpen(false)}
        onSelectQuery={handleSelectJournalQuery}
      />

      <StatusBar
        limits={rateLimits}
        repos={repos}
        isSearching={isSearching}
        isOnline={isOnline}
        journal={systemMetrics?.journal || null}
        onOpenNotebook={() => setIsSystemOpen(true)}
      />
    </div>
  );
}
