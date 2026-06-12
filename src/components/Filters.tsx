import React, { useState, useEffect } from 'react';
import { AccountInfo, RepoInfo, getExternalRepos, addExternalRepo, removeExternalRepo } from '../api';
import { ShieldCheck, Filter, Terminal, Sliders, RotateCcw, HelpCircle, Activity, Globe, Plus, X, Loader } from 'lucide-react';

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

  // Calibrator mathematical inputs
  similarityThreshold: number;
  setSimilarityThreshold: (val: number) => void;
  pathBoost: number;
  setPathBoost: (val: number) => void;
  k1: number;
  setK1: (val: number) => void;
  b: number;
  setB: (val: number) => void;
  maxLineLength: number;
  setMaxLineLength: (val: number) => void;

  // External repos changed (added/removed) → parent reloads workspace data
  onExternalChange: () => void;
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
  setExtQuery,
  similarityThreshold,
  setSimilarityThreshold,
  pathBoost,
  setPathBoost,
  k1,
  setK1,
  b,
  setB,
  maxLineLength,
  setMaxLineLength,
  onExternalChange
}: FiltersProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [isTunerExpanded, setIsTunerExpanded] = useState(false);
  const [showHelp, setShowHelp] = useState<string | null>(null);

  // External repos
  const [externals, setExternals] = useState<string[]>([]);
  const [extInput, setExtInput] = useState('');
  const [extBusy, setExtBusy] = useState(false);
  const [extError, setExtError] = useState<string | null>(null);

  const loadExternals = async () => {
    try {
      setExternals(await getExternalRepos());
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadExternals();
  }, []);

  const handleAddExternal = async () => {
    const repo = extInput.trim();
    if (!repo) return;
    setExtBusy(true);
    setExtError(null);
    try {
      const r = await addExternalRepo(repo);
      setExtInput('');
      await loadExternals();
      onExternalChange();
      if (r.warning) setExtError(r.warning);
    } catch (err: any) {
      setExtError(err?.message || 'Failed to add repository.');
    } finally {
      setExtBusy(false);
    }
  };

  const handleRemoveExternal = async (repo: string) => {
    setExtBusy(true);
    setExtError(null);
    try {
      await removeExternalRepo(repo);
      await loadExternals();
      onExternalChange();
    } catch (err: any) {
      setExtError(err?.message || 'Failed to remove repository.');
    } finally {
      setExtBusy(false);
    }
  };

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

  const handleResetCalibration = () => {
    setSimilarityThreshold(0.10);
    setPathBoost(0.25);
    setK1(1.20);
    setB(0.75);
    setMaxLineLength(350);
  };

  // Dynamically calculate estimated scan complexity based on line length constraints and active selection
  const selectedReposInstances = repos.filter(r => selectedRepos.includes(r.id));
  const estimatedRepoLines = selectedReposInstances.reduce((sum, r) => sum + (r.lineCount || 0), 0);
  
  let complexityVibe = 'Low Cost';
  let complexityColor = 'text-emerald-400';
  if (estimatedRepoLines > 50000) {
    complexityVibe = 'Moderate Cost';
    complexityColor = 'text-amber-400';
  }
  if (estimatedRepoLines > 150000 || maxLineLength > 1000) {
    complexityVibe = 'High Cost';
    complexityColor = 'text-red-400';
  }

  return (
    <div className={`flex flex-col bg-[#1E1F20] border-r border-[#2A2C2E] h-full transition-all duration-300 ${isOpen ? 'w-64' : 'w-12'}`}>
      {/* Collapse header */}
      <div className="flex items-center justify-between border-b border-[#2A2C2E] px-3 py-2.5 text-xs font-semibold text-gray-400 shrink-0">
        {isOpen && (
          <div className="flex items-center gap-1.5 text-white">
            <Filter className="w-3.5 h-3.5 text-[#4F8CFF]" />
            <span>EXAMINATION FILTERS</span>
          </div>
        )}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="text-gray-550 hover:text-white p-1 rounded hover:bg-[#0F1115] mx-auto md:mx-0 font-mono transition-colors"
          title={isOpen ? 'Collapse panel' : 'Expand panel'}
        >
          {isOpen ? '◀' : '▶'}
        </button>
      </div>

      {isOpen && (
        <div className="flex-1 overflow-y-auto px-3.5 py-4 space-y-4 select-none font-sans text-xs scrollbar-thin">
          {/* 1. Accounts Selector */}
          <div>
            <div className="text-gray-400 font-semibold mb-2 tracking-wide text-[10px] uppercase">
              GitHub Accounts
            </div>
            <div className="space-y-1.5">
              {accounts.map(acc => (
                <label 
                  key={acc.login} 
                  className="flex items-center justify-between p-1.5 rounded bg-[#0F1115] hover:bg-zinc-850 cursor-pointer border border-[#2E3035]/30 hover:border-zinc-700 transition-all"
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
                    <span className="bg-emerald-950/60 border border-emerald-800/40 text-emerald-400 font-bold px-1 rounded text-[9px] lowercase flex items-center gap-0.5">
                      <ShieldCheck className="w-2.5 h-2.5" />
                      pat
                    </span>
                  ) : (
                    <span className="bg-amber-950/60 border border-amber-900/40 text-amber-500 font-semibold px-1 py-0.2 rounded text-[9px]">
                      demo
                    </span>
                  )}
                </label>
              ))}
            </div>
          </div>

          {/* 1b. External repos — search ANY GitHub repo */}
          <div>
            <div className="text-gray-400 font-semibold mb-2 tracking-wide text-[10px] uppercase flex items-center gap-1.5">
              <Globe className="w-3 h-3 text-[#4F8CFF]" />
              External Repos
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={extInput}
                onChange={e => setExtInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddExternal(); }}
                placeholder="owner/repo"
                disabled={extBusy}
                className="flex-1 bg-[#0F1115] border border-[#2A2C2E] rounded px-2 py-1 select-text text-xs focus:outline-none focus:border-[#4F8CFF] text-[#E3E3E3] disabled:opacity-50"
              />
              <button
                onClick={handleAddExternal}
                disabled={extBusy || !extInput.trim()}
                className="bg-[#4F8CFF] text-[#0F1115] rounded px-2 py-1 font-bold disabled:bg-zinc-800 disabled:text-gray-500 transition-colors"
                title="Mirror and index this repository"
              >
                {extBusy ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              </button>
            </div>
            {extError && (
              <div className="mt-1.5 text-[10px] text-amber-500 leading-snug break-words">{extError}</div>
            )}
            {externals.length > 0 && (
              <div className="mt-2 space-y-1">
                {externals.map(repo => {
                  const entry = repos.find(r => r.id === repo);
                  return (
                    <div key={repo} className="flex items-center justify-between gap-1.5 bg-[#0F1115] border border-[#2A2C2E]/60 rounded px-2 py-1 text-[11px]">
                      <span className="font-mono text-[#E3E3E3] truncate" title={repo}>{repo}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-mono text-[9px] text-gray-500">
                          {entry?.status === 'indexed'
                            ? `${(entry.lineCount || 0).toLocaleString()} lines`
                            : (entry?.status || 'pending')}
                        </span>
                        <button
                          onClick={() => handleRemoveExternal(repo)}
                          disabled={extBusy}
                          className="text-gray-500 hover:text-red-400 transition-colors"
                          title="Remove and drop its index"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
          <div className="flex flex-col h-[28vh]">
            <div className="flex items-center justify-between mb-1.5 shrink-0">
              <span className="text-gray-400 font-semibold tracking-wide text-[10px] uppercase">
                Repositories ({repos.length})
              </span>
              <button
                onClick={handleSelectAllRepos}
                className="text-[#4F8CFF] hover:underline hover:text-white p-0 text-[10px] font-medium"
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

          {/* 4. Google-Grade Engine Calibration Panel (Accordion) */}
          <div className="border border-[#2A2C2E] rounded bg-[#0F1115] overflow-hidden transition-all duration-300">
            <button
              onClick={() => setIsTunerExpanded(!isTunerExpanded)}
              className="w-full flex items-center justify-between px-3 py-2 bg-[#252627] text-[10px] font-bold text-[#E3E3E3] hover:bg-[#2A2C2E] uppercase transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-amber-500" />
                <span>ENGINE CALIBRATION</span>
              </div>
              <span className="text-gray-500 text-[9px]">{isTunerExpanded ? '▲' : '▼'}</span>
            </button>

            {isTunerExpanded && (
              <div className="p-3 space-y-3.5 border-t border-[#2A2C2E] text-[11px] bg-[#121316]">
                {/* Calibration parameters description help bubbles */}
                {showHelp && (
                  <div className="bg-[#252627] border border-amber-900/40 rounded p-2 text-[10px] text-gray-300 leading-relaxed relative">
                    <button 
                      onClick={() => setShowHelp(null)} 
                      className="absolute top-1 right-1 text-gray-500 hover:text-white"
                    >
                      ✕
                    </button>
                    {showHelp === 'similarity' && (
                      <p><strong>Similarity Threshold</strong>: Minimum cosine overlay score to qualify a document. Set low for exploratory discovery, and high to discard ambient noise matches.</p>
                    )}
                    {showHelp === 'path' && (
                      <p><strong>Path Boost Factor</strong>: Score modifier multiplier appended when the query keyword coincides with file folders or extension pathways.</p>
                    )}
                    {showHelp === 'k1' && (
                      <p><strong>BM25 k1 coefficient</strong>: Scales frequency saturation. Lowering suppresses repeating jargon; higher mimics classic boolean frequency growth patterns.</p>
                    )}
                    {showHelp === 'b' && (
                      <p><strong>BM25 b coefficient</strong>: Document length penalization. b=1 heavily penalizes long boilerplate codebase structures; b=0 disables physical size weight penalties.</p>
                    )}
                    {showHelp === 'linelen' && (
                      <p><strong>Line-Length Boundary</strong>: Defensive limit ignoring lines over this limit (e.g. minified pack files) protecting execution clock speeds.</p>
                    )}
                  </div>
                )}

                {/* Parameter 1: Similarity Threshold */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-gray-400">
                    <span className="flex items-center gap-1">
                      Similarity Threshold
                      <button onClick={() => setShowHelp('similarity')} className="hover:text-[#4F8CFF] cursor-help">
                        <HelpCircle className="w-3 h-3" />
                      </button>
                    </span>
                    <span className="font-mono text-white text-[10px]">{similarityThreshold.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.01"
                    max="0.90"
                    step="0.05"
                    value={similarityThreshold}
                    onChange={e => setSimilarityThreshold(parseFloat(e.target.value))}
                    className="w-full h-1 bg-[#1E1F20] rounded-lg appearance-none cursor-pointer accent-[#4F8CFF]"
                  />
                </div>

                {/* Parameter 2: Path Boost */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-gray-400">
                    <span className="flex items-center gap-1">
                      Path Boost Factor
                      <button onClick={() => setShowHelp('path')} className="hover:text-[#4F8CFF] cursor-help">
                        <HelpCircle className="w-3 h-3" />
                      </button>
                    </span>
                    <span className="font-mono text-white text-[10px]">{pathBoost.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.00"
                    max="1.00"
                    step="0.05"
                    value={pathBoost}
                    onChange={e => setPathBoost(parseFloat(e.target.value))}
                    className="w-full h-1 bg-[#1E1F20] rounded-lg appearance-none cursor-pointer accent-[#4F8CFF]"
                  />
                </div>

                {/* Parameter 3: BM25 k1 */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-gray-400">
                    <span className="flex items-center gap-1">
                      BM25 Saturation (k1)
                      <button onClick={() => setShowHelp('k1')} className="hover:text-[#4F8CFF] cursor-help">
                        <HelpCircle className="w-3 h-3" />
                      </button>
                    </span>
                    <span className="font-mono text-white text-[10px]">{k1.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.10"
                    max="3.00"
                    step="0.10"
                    value={k1}
                    onChange={e => setK1(parseFloat(e.target.value))}
                    className="w-full h-1 bg-[#1E1F20] rounded-lg appearance-none cursor-pointer accent-[#4F8CFF]"
                  />
                </div>

                {/* Parameter 4: BM25 b */}
                 <div className="space-y-1">
                  <div className="flex justify-between items-center text-gray-400">
                    <span className="flex items-center gap-1">
                      BM25 Normalization (b)
                      <button onClick={() => setShowHelp('b')} className="hover:text-[#4F8CFF] cursor-help">
                        <HelpCircle className="w-3 h-3" />
                      </button>
                    </span>
                    <span className="font-mono text-white text-[10px]">{b.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.00"
                    max="1.00"
                    step="0.05"
                    value={b}
                    onChange={e => setB(parseFloat(e.target.value))}
                    className="w-full h-1 bg-[#1E1F20] rounded-lg appearance-none cursor-pointer accent-[#4F8CFF]"
                  />
                </div>

                {/* Parameter 5: Max Line Length limit */}
                <div className="space-y-1">
                  <div className="flex justify-between items-center text-gray-400">
                    <span className="flex items-center gap-1">
                      Max Scanned Line Length
                      <button onClick={() => setShowHelp('linelen')} className="hover:text-[#4F8CFF] cursor-help">
                        <HelpCircle className="w-3 h-3" />
                      </button>
                    </span>
                    <span className="font-mono text-white text-[10px]">{maxLineLength} ch</span>
                  </div>
                  <input
                    type="range"
                    min="100"
                    max="1500"
                    step="50"
                    value={maxLineLength}
                    onChange={e => setMaxLineLength(parseInt(e.target.value, 10))}
                    className="w-full h-1 bg-[#1E1F20] rounded-lg appearance-none cursor-pointer accent-[#4F8CFF]"
                  />
                </div>

                {/* Calibration metadata and reset triggers */}
                <div className="border-t border-[#2A2C2E]/50 pt-2.5 flex items-center justify-between text-[9px] text-gray-500 font-mono">
                  <div className="flex items-center gap-1">
                    <Activity className="w-3 h-3 text-emerald-500" />
                    <span>Cost: <strong className={complexityColor}>{complexityVibe}</strong></span>
                  </div>
                  <button
                    onClick={handleResetCalibration}
                    className="text-gray-450 hover:text-white hover:underline uppercase flex items-center gap-1 transition-colors p-0.5"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Reset Calibration</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
