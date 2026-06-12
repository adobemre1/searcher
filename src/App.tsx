import React, { useState, useEffect, useRef } from 'react';
import {
  getAccounts,
  getRepos,
  getSyncStatus,
  getRateLimits,
  search,
  AccountInfo,
  RepoInfo,
  SyncStatus,
  RateLimits,
  SearchResponse
} from './api';

import SearchBar from './components/SearchBar';
import Filters from './components/Filters';
import ResultList from './components/ResultList';
import SyncPanel from './components/SyncPanel';
import StatusBar from './components/StatusBar';
import DemoBanner from './components/DemoBanner';
import DoctorModal from './components/DoctorModal';

export default function App() {
  // Database configuration states
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [rateLimits, setRateLimits] = useState<RateLimits | null>(null);
  const [searchResponse, setSearchResponse] = useState<SearchResponse | null>(null);

  // Filter controllers
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [pathQuery, setPathQuery] = useState('');
  const [extQuery, setExtQuery] = useState('');

  // Active inputs states
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'mirror' | 'live'>('mirror');
  const [regex, setRegex] = useState(false);
  const [word, setWord] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [fold, setFold] = useState(true);

  // Status indicators
  const [isSearching, setIsSearching] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Layout UI states
  const [isSyncPanelOpen, setIsSyncPanelOpen] = useState(false);
  const [isDoctorOpen, setIsDoctorOpen] = useState(false);

  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load baseline statistics on mount (M1, M3)
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

      // Pre-select both search accounts by default
      if (accs.length > 0 && selectedAccounts.length === 0) {
        setSelectedAccounts(accs.map(a => a.login));
      }
    } catch (err) {
      console.error('Failed to load initial workspace logs:', err);
    }
  };

  useEffect(() => {
    loadWorkspaceData();
    
    // Periodically update rate limits on the bottom bar every 15 seconds
    const rateTimer = setInterval(async () => {
      try {
        const rates = await getRateLimits();
        setRateLimits(rates);
      } catch {}
    }, 15000);

    // Track online state
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

  // Poll synchronization progress status if sync is actively running
  useEffect(() => {
    let pollInterval: NodeJS.Timeout | null = null;

    if (syncStatus?.active) {
      pollInterval = setInterval(async () => {
        try {
          const status = await getSyncStatus();
          setSyncStatus(status);
          
          if (!status.active) {
            // Reload accounts list and repos lines counts when synchronization completed
            const reposList = await getRepos();
            setRepos(reposList);
            const rates = await getRateLimits();
            setRateLimits(rates);
          }
        } catch (err) {
          console.error('Failed to poll sync states:', err);
        }
      }, 1500);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [syncStatus?.active]);

  // Handle live search triggers and debounced inputs for mirror searches (MODE_QUANTUM_EFFICIENCY)
  const triggerSearch = async () => {
    if (!q.trim()) {
      setSearchResponse(null);
      setSearchError(null);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await search({
        q,
        mode,
        regex,
        word,
        caseSensitive,
        fold,
        accounts: selectedAccounts,
        repos: selectedRepos,
        path: pathQuery || undefined,
        ext: extQuery || undefined
      });
      setSearchResponse(res);
    } catch (err: any) {
      setSearchError(err?.message || 'Search execution failed');
      // Render clean feedback error
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

  // Trigger search dynamically when options or inputs shift (with debounce for mirror queries)
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    if (mode === 'live') {
      // In live proxy mode: wait for explicit user search submission/enter click to avoid accidental spam
      return;
    }

    // Debounce search input for free mirror searches to keep rendering fluid
    searchTimerRef.current = setTimeout(() => {
      triggerSearch();
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [q, mode, regex, word, caseSensitive, fold, selectedAccounts, selectedRepos, pathQuery, extQuery]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0F1115] text-[#E3E3E3] font-sans">
      {/* Amber Demo Disclaimer strip if tokens are missing */}
      <DemoBanner accounts={accounts} />

      {/* Top Search inputs Bar and Mode Selects */}
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
        onSearchTrigger={triggerSearch}
        isSearching={isSearching}
        openDoctor={() => setIsDoctorOpen(true)}
        isSyncing={syncStatus?.active || false}
        toggleSyncPanel={() => setIsSyncPanelOpen(!isSyncPanelOpen)}
      />

      {/* Main body of layout split into Filters sidebar and results panel */}
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
        />

        {/* Results matching code loops */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {searchError && (
            <div className="bg-red-950/40 border-b border-red-900/50 p-3 text-red-400 font-mono text-xs flex justify-between items-center shrink-0 leading-relaxed select-text">
              <span><strong>Search Error:</strong> {searchError}</span>
              <button onClick={() => setSearchError(null)} className="text-gray-550 hover:text-white px-1 font-sans">✕</button>
            </div>
          )}
          
          <ResultList response={searchResponse} isSearching={isSearching} q={q} />
        </div>

        {/* Sync panel right drawer toggler */}
        <SyncPanel 
          status={syncStatus} 
          onRefresh={loadWorkspaceData} 
          isOpen={isSyncPanelOpen} 
          onClose={() => setIsSyncPanelOpen(false)} 
        />
      </div>

      {/* System diagnostics Doctor modal */}
      <DoctorModal isOpen={isDoctorOpen} onClose={() => setIsDoctorOpen(false)} />

      {/* Footer statistics gauges */}
      <StatusBar 
        limits={rateLimits} 
        repos={repos} 
        isSearching={isSearching} 
        isOnline={isOnline} 
      />
    </div>
  );
}
