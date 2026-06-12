import React, { useEffect, useRef } from 'react';
import { Search, SlidersHorizontal, RefreshCw, HelpCircle, Monitor, Cpu } from 'lucide-react';

interface SearchBarProps {
  q: string;
  setQ: (val: string) => void;
  mode: 'mirror' | 'live' | 'semantic';
  setMode: (val: 'mirror' | 'live' | 'semantic') => void;
  regex: boolean;
  setRegex: (val: boolean) => void;
  word: boolean;
  setWord: (val: boolean) => void;
  caseSensitive: boolean;
  setCaseSensitive: (val: boolean) => void;
  fold: boolean;
  setFold: (val: boolean) => void;
  liveScope: 'configured' | 'global';
  setLiveScope: (val: 'configured' | 'global') => void;
  onSearchTrigger: () => void;
  isSearching: boolean;
  openDoctor: () => void;
  isSyncing: boolean;
  toggleSyncPanel: () => void;
  openSystem: () => void;
}

export default function SearchBar({
  q,
  setQ,
  mode,
  setMode,
  regex,
  setRegex,
  word,
  setWord,
  caseSensitive,
  setCaseSensitive,
  fold,
  setFold,
  liveScope,
  setLiveScope,
  onSearchTrigger,
  isSearching,
  openDoctor,
  isSyncing,
  toggleSyncPanel,
  openSystem
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus search input using ⌘K or / key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setQ('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setQ]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQ(e.target.value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      onSearchTrigger();
    }
  };

  return (
    <div className="w-full bg-[#1E1F20] border-b border-[#2A2C2E] px-4 py-3 flex flex-col md:flex-row items-center gap-3">
      {/* Brand & Input */}
      <div className="flex items-center gap-3 w-full md:w-auto flex-1">
        <div className="flex items-center gap-2 text-[#4F8CFF] font-semibold text-lg tracking-wider">
          <Search className="w-5 h-5" />
          <span>ecysearch</span>
        </div>
        
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-[#0F1115] text-[#E3E3E3] placeholder-gray-500 rounded border border-[#2A2C2E] pl-10 pr-16 py-1.5 text-sm focus:outline-none focus:border-[#4F8CFF] font-sans"
            placeholder="Type 'danisman', 'verse', 'mathlib' ... (⌘K)"
            value={q || ''}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {q && (
              <button 
                onClick={() => setQ('')}
                className="text-gray-500 hover:text-white text-xs px-1 rounded hover:bg-zinc-800"
              >
                Clear
              </button>
            )}
            <kbd className="hidden sm:inline bg-zinc-800 text-gray-400 text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 select-none">
              ⌘K
            </kbd>
          </div>
        </div>
      </div>

      {/* Control Tools */}
      <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
        {/* Mirror vs Live vs Semantic Pills */}
        <div className="bg-[#0F1115] border border-[#2A2C2E] p-0.5 rounded flex items-center">
          <button
            onClick={() => setMode('mirror')}
            className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
              mode === 'mirror'
                ? 'bg-[#4F8CFF] text-[#0F1115]'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Mirror Mode
          </button>
          <button
            onClick={() => setMode('live')}
            className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
              mode === 'live'
                ? 'bg-[#4F8CFF] text-[#0F1115]'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Live Mode
          </button>
          <button
            onClick={() => setMode('semantic')}
            className={`px-3 py-1 text-xs font-semibold rounded transition-colors ${
              mode === 'semantic'
                ? 'bg-[#4F8CFF] text-[#0F1115]'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Semantic Mode
          </button>
        </div>

        {/* Live scope: My repos (user: qualifier) vs Global (all of GitHub) */}
        {mode === 'live' && (
          <div className="bg-[#0F1115] border border-[#2A2C2E] p-0.5 rounded flex items-center" title="Live mode scope">
            <button
              onClick={() => setLiveScope('configured')}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${
                liveScope === 'configured' ? 'bg-zinc-800 text-[#4F8CFF]' : 'text-gray-500 hover:text-white'
              }`}
            >
              My repos
            </button>
            <button
              onClick={() => setLiveScope('global')}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-colors ${
                liveScope === 'global' ? 'bg-zinc-800 text-[#4F8CFF]' : 'text-gray-500 hover:text-white'
              }`}
            >
              Global
            </button>
          </div>
        )}

        {/* Action Toggle Chips */}
        <div className="flex items-center gap-1 bg-[#0F1115] border border-[#2A2C2E] p-0.5 rounded">
          <button
            onClick={() => setFold(!fold)}
            className={`px-2 py-1 text-[11px] font-semibold rounded transition-colors ${
              fold ? 'bg-zinc-800 text-[#4F8CFF]' : 'text-gray-500 hover:text-white'
            }`}
            title="Folding diacritics like ı->i, ş->s"
          >
            TR Fold
          </button>
          
          <button
            onClick={() => setCaseSensitive(!caseSensitive)}
            className={`px-2 py-1 text-[11px] font-semibold rounded transition-colors ${
              caseSensitive ? 'bg-zinc-800 text-[#4F8CFF]' : 'text-gray-500 hover:text-white'
            }`}
            title="Case sensitive match"
          >
            Aa Case
          </button>
          
          <button
            onClick={() => setWord(!word)}
            className={`px-2 py-1 text-[11px] font-semibold rounded transition-colors ${
              word ? 'bg-zinc-800 text-[#4F8CFF]' : 'text-gray-500 hover:text-white'
            }`}
            title="Whole word exact match"
          >
            \b Word
          </button>

          <button
            onClick={() => setRegex(!regex)}
            className={`px-2 py-1 text-[11px] font-semibold rounded transition-colors ${
              regex ? 'bg-zinc-800 text-[#4F8CFF]' : 'text-gray-500 hover:text-white'
            }`}
            title="Regular expression query"
          >
            .* Regex
          </button>
        </div>

        {/* Doctor & Sync Buttons */}
        <button
          onClick={openSystem}
          className="bg-[#0F1115] hover:text-[#4F8CFF] border border-[#2A2C2E] px-3 py-1.5 rounded flex items-center gap-1.5 text-xs transition-colors font-semibold text-[#E3E3E3]"
          title="System metrics, search history and the found-words notebook"
        >
          <Cpu className="w-3.5 h-3.5 text-[#4F8CFF]" />
          <span>System</span>
        </button>

        <button
          onClick={openDoctor}
          className="bg-[#0F1115] text-[#E3E3E3] hover:text-[#4F8CFF] border border-[#2A2C2E] p-1.5 rounded transition-colors"
          title="Run pipeline diagnostics check"
        >
          <HelpCircle className="w-4 h-4" />
        </button>

        <button
          onClick={toggleSyncPanel}
          className={`bg-[#0F1115] hover:text-[#4F8CFF] border border-[#2A2C2E] px-3 py-1.5 rounded flex items-center gap-1.5 text-xs transition-colors font-semibold ${
            isSyncing ? 'text-amber-400' : 'text-[#E3E3E3]'
          }`}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>Sync Status</span>
        </button>
      </div>
    </div>
  );
}
