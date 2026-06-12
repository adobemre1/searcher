import React, { useState } from 'react';
import { AccountInfo, RepoInfo } from '../api';
import { ShieldCheck, Database, FolderGit, Filter, Terminal } from 'lucide-react';

interface FiltersProps {
  accounts: AccountInfo[];
  repos: RepoInfo[];
  selectedAccounts: string[];
  setSelectedAccounts: (accs: string[]) => void;
  selectedRepos: string[];
  setSelectedRepos: (repos: string[]) => void;
  pathQuery: string;
  setPathQuery: (val: string) => void;
  extQuery: string;
  setExtQuery: (val: string) => void;
}

export default function Filters({
  accounts,
  repos,
  selectedAccounts,
  setSelectedAccounts,
  selectedRepos,
  setSelectedRepos,
  pathQuery,
  setPathQuery,
  extQuery,
  setExtQuery
}: FiltersProps) {
  const [isOpen, setIsOpen] = useState(true);

  const handleAccountToggle = (login: string) => {
    if (selectedAccounts.includes(login)) {
      setSelectedAccounts(selectedAccounts.filter(l => l !== login));
    } else {
      setSelectedAccounts([...selectedAccounts, login]);
    }
  };

  const handleRepoToggle = (id: string) => {
    if (selectedRepos.includes(id)) {
      setSelectedRepos(selectedRepos.filter(item => item !== id));
    } else {
      setSelectedRepos([...selectedRepos, id]);
    }
  };

  const handleSelectAllRepos = () => {
    if (selectedRepos.length === repos.length) {
      setSelectedRepos([]);
    } else {
      setSelectedRepos(repos.map(r => r.id));
    }
  };

  return (
    <div className={`flex flex-col bg-[#1E1F20] border-r border-[#2A2C2E] h-full transition-all duration-300 ${isOpen ? 'w-64' : 'w-12'}`}>
      {/* Collapse header */}
      <div className="flex items-center justify-between border-b border-[#2A2C2E] px-3 py-2.5 text-xs font-semibold text-gray-400">
        {isOpen && (
          <div className="flex items-center gap-1.5 text-white">
            <Filter className="w-3.5 h-3.5 text-[#4F8CFF]" />
            <span>EXAMINATION FILTERS</span>
          </div>
        )}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-gray-500 hover:text-white p-1 rounded hover:bg-[#0F1115] mx-auto md:mx-0"
          title={isOpen ? 'Collapse panel' : 'Expand panel'}
        >
          {isOpen ? '◀' : '▶'}
        </button>
      </div>

      {isOpen && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5 select-none font-sans text-xs">
          {/* 1. Accounts Selector */}
          <div>
            <div className="text-gray-400 font-semibold mb-2 tracking-wide text-[10px] uppercase">
              GitHub Accounts
            </div>
            <div className="space-y-2">
              {accounts.map(acc => (
                <label 
                  key={acc.login} 
                  className="flex items-center justify-between p-1.5 rounded bg-[#0F1115] hover:bg-zinc-850 cursor-pointer border border-transparent hover:border-zinc-700"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedAccounts.includes(acc.login)}
                      onChange={() => handleAccountToggle(acc.login)}
                      className="rounded border-[#2A2C2E] bg-[#0F1115] text-[#4F8CFF] focus:ring-0 checked:bg-[#4F8CFF]"
                    />
                    <span className="font-medium text-[#E3E3E3]">{acc.login}</span>
                  </div>
                  {acc.hasToken ? (
                    <span className="bg-emerald-950 border border-emerald-800 text-emerald-400 font-bold px-1 rounded text-[9px] lowercase flex items-center gap-0.5">
                      <ShieldCheck className="w-2.5 h-2.5" />
                      pat
                    </span>
                  ) : (
                    <span className="bg-amber-950 border border-amber-900 text-amber-500 font-semibold px-1 py-0.2 rounded text-[9px]">
                      demo
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* 2. File Ext & Paths */}
          <div>
            <div className="text-gray-400 font-semibold mb-2 tracking-wide text-[10px] uppercase">
              Path / Extension Matches
            </div>
            <div className="space-y-2">
              <div>
                <span className="text-[10px] text-gray-500 block mb-1">Glob Pattern Filter</span>
                <input
                  type="text"
                  value={pathQuery}
                  onChange={e => setPathQuery(e.target.value)}
                  placeholder="e.g. src/components"
                  className="w-full bg-[#0F1115] border border-[#2A2C2E] rounded px-2 py-1 select-text text-xs focus:outline-none focus:border-[#4F8CFF] text-[#E3E3E3]"
                />
              </div>
              
              <div>
                <span className="text-[10px] text-gray-500 block mb-1">File Extension Target</span>
                <input
                  type="text"
                  value={extQuery}
                  onChange={e => setExtQuery(e.target.value)}
                  placeholder="e.g. ts"
                  className="w-full bg-[#0F1115] border border-[#2A2C2E] rounded px-2 py-1 select-text text-xs focus:outline-none focus:border-[#4F8CFF] text-[#E3E3E3]"
                />
              </div>
            </div>
          </div>

          {/* 3. Repos Multi Select */}
          <div className="flex flex-col flex-1 h-[40vh]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 font-semibold tracking-wide text-[10px] uppercase">
                Repositories ({repos.length})
              </span>
              <button
                onClick={handleSelectAllRepos}
                className="text-[#4F8CFF] hover:underline hover:text-white p-0 text-[10px]"
              >
                {selectedRepos.length === repos.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>

            <div className="flex-1 bg-[#0F1115] border border-[#2A2C2E] rounded overflow-y-auto p-2 space-y-1.5">
              {repos.length === 0 ? (
                <div className="text-gray-500 text-center py-4 text-[10px]">No repos indexed.</div>
              ) : (
                repos.map(r => (
                  <label
                    key={r.id}
                    className="flex items-start gap-2 p-1 rounded hover:bg-[#1E1F20] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRepos.includes(r.id)}
                      onChange={() => handleRepoToggle(r.id)}
                      className="mt-0.5 rounded border-[#2E3035] bg-[#0F1115] text-[#4F8CFF] focus:ring-0 select-none"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[#E3E3E3] font-medium truncate flex items-center justify-between gap-1" title={r.id}>
                        <span className="truncate">{r.name}</span>
                        {r.private && (
                          <span className="bg-red-950 border border-red-800 text-red-500 text-[8px] font-bold px-0.5 rounded">
                            p
                          </span>
                        )}
                      </div>
                      <div className="text-gray-500 font-mono text-[9px] flex items-center gap-1.5 mt-0.5">
                        <Terminal className="w-2.5 h-2.5 text-zinc-600" />
                        <span>{r.lineCount !== undefined ? r.lineCount.toLocaleString() : 0} lines</span>
                        {r.stale && (
                          <span className="text-amber-500 animate-pulse text-[8px]" title="Behind origin HEAD, reload needed">
                            stale
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
