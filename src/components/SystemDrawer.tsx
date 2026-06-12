import React, { useEffect, useState } from 'react';
import {
  getJournalEntries,
  getJournalWords,
  clearJournal,
  journalExportUrl,
  getSystemMetrics,
  JournalEntry,
  WordAggregate,
  SystemMetrics
} from '../api';
import {
  Activity,
  BookOpen,
  Clock,
  Cpu,
  Download,
  FileJson,
  FileText,
  NotebookPen,
  Search,
  Server,
  Trash2
} from 'lucide-react';

interface SystemDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectQuery: (q: string, config?: Partial<Pick<JournalEntry, 'mode' | 'flags' | 'filters'>>) => void;
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function timeAgo(iso: string): string {
  const diffSec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${Math.floor(diffSec)}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export default function SystemDrawer({ isOpen, onClose, onSelectQuery }: SystemDrawerProps) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [words, setWords] = useState<WordAggregate[]>([]);
  const [system, setSystem] = useState<SystemMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'system' | 'history' | 'words'>('words');

  const loadData = async () => {
    try {
      const [ents, wds, sys] = await Promise.all([
        getJournalEntries(200),
        getJournalWords(),
        getSystemMetrics()
      ]);
      setEntries(ents);
      setWords(wds);
      setSystem(sys);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load system data');
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
      // 5s refresh: index stats are cached server-side, this stays cheap.
      const poll = setInterval(loadData, 5000);
      return () => clearInterval(poll);
    }
  }, [isOpen]);

  const handleClear = async () => {
    if (window.confirm('Clear the journal? Words and history entries are removed. This is local and permanent.')) {
      try {
        await clearJournal();
        setEntries([]);
        setWords([]);
      } catch (err: any) {
        alert(err?.message || 'Clear failed.');
      }
    }
  };

  if (!isOpen) return null;

  const entryRow = (log: JournalEntry) => (
    <div
      key={log.id}
      onClick={() => onSelectQuery(log.q, { mode: log.mode, flags: log.flags, filters: log.filters })}
      className="p-3 bg-zinc-900 border border-zinc-800 rounded hover:border-[#4F8CFF]/80 cursor-pointer transition-all flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
    >
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-1.5 font-mono text-zinc-200">
          <span className="text-[#4F8CFF] font-bold select-all truncate">{log.q}</span>
          {log.repeats > 1 && (
            <span className="bg-zinc-800 text-zinc-400 px-1 rounded text-[9px]">×{log.repeats}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1 text-[9px] font-mono text-zinc-500">
          <span className={`px-1.5 py-0.5 rounded ${log.mode === 'live' ? 'bg-amber-950/60 text-amber-500' : log.mode === 'semantic' ? 'bg-purple-950/60 text-purple-400' : 'bg-blue-950/60 text-blue-400'}`}>
            {log.mode.toUpperCase()}
          </span>
          {log.flags.regex && <span className="bg-zinc-800 text-zinc-400 px-1 py-0.5 rounded">Regex</span>}
          {log.flags.fold && <span className="bg-zinc-800 text-zinc-400 px-1 py-0.5 rounded">Fold</span>}
          {log.flags.caseSensitive && <span className="bg-zinc-800 text-zinc-400 px-1 py-0.5 rounded">Case</span>}
          {log.flags.word && <span className="bg-zinc-800 text-zinc-400 px-1 py-0.5 rounded">Word</span>}
          {!log.found && <span className="bg-red-950/50 text-red-400 px-1 py-0.5 rounded">0 hits</span>}
        </div>
      </div>
      <div className="text-right shrink-0 font-mono text-[10px] space-y-1">
        <div className="text-zinc-200 flex items-center justify-end gap-1.5">
          <Clock className="w-3 h-3 text-zinc-500" />
          <span>{log.tookMs.toFixed(1)} ms</span>
          <span className="text-zinc-600">·</span>
          <span className="text-[#4F8CFF] font-bold">{log.totalFound} matches</span>
        </div>
        <div className="text-zinc-600">{timeAgo(log.ts)}</div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-end z-50 font-sans">
      <div className="w-full max-w-2xl h-full bg-[#121418] border-l border-[#2A2C2E] flex flex-col shadow-2xl relative select-none">
        <div className="absolute top-0 left-0 w-full h-[3px] bg-[#4F8CFF]" />

        {/* Header */}
        <div className="p-4 border-b border-[#2A2C2E] bg-[#1E1F20] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <NotebookPen className="w-5 h-5 text-[#4F8CFF]" />
            <div>
              <h3 className="text-white text-xs uppercase tracking-wider font-bold">System & Notebook</h3>
              <p className="text-[10px] text-zinc-500">Measured metrics · search journal · found-words notebook</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={journalExportUrl('md')}
              download
              className="text-[#4F8CFF] hover:bg-[#4F8CFF]/10 px-2.5 py-1.5 text-[11px] border border-[#4F8CFF]/30 rounded transition-colors font-semibold flex items-center gap-1"
              title="Export notebook as Markdown"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>md</span>
            </a>
            <a
              href={journalExportUrl('json')}
              download
              className="text-[#4F8CFF] hover:bg-[#4F8CFF]/10 px-2.5 py-1.5 text-[11px] border border-[#4F8CFF]/30 rounded transition-colors font-semibold flex items-center gap-1"
              title="Export notebook as JSON"
            >
              <FileJson className="w-3.5 h-3.5" />
              <span>json</span>
            </a>
            <button
              onClick={handleClear}
              className="text-red-400 hover:bg-red-950/40 px-2.5 py-1.5 text-[11px] border border-red-900/50 rounded transition-colors font-semibold flex items-center gap-1"
              title="Clear journal"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white px-2.5 py-1.5 text-[11px] bg-zinc-800 rounded hover:bg-zinc-700 transition-colors font-medium border border-zinc-700/50"
            >
              ✕ Close
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="p-2 bg-[#1A1C20] border-b border-[#2A2C2E] flex gap-2">
          {([
            { id: 'words', icon: BookOpen, label: `Words (${words.length})` },
            { id: 'history', icon: Activity, label: `History (${entries.length})` },
            { id: 'system', icon: Cpu, label: 'System' }
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-1.5 rounded text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                tab === t.id
                  ? 'bg-[#4F8CFF] text-[#0F1115]'
                  : 'bg-[#121418] border border-[#2A2C2E] text-gray-400 hover:text-white'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-[#0E1013]">
          {error && (
            <div className="bg-red-950/40 border border-red-900/50 p-4 rounded text-red-400 text-xs">{error}</div>
          )}

          {tab === 'words' && (
            <div className="space-y-3">
              <p className="text-[11px] text-zinc-500">
                Every committed search (Enter or a settled query, ≥ 3 chars) is noted here. Click a word to search it again.
                {system && system.journal.redactedCount > 0 && (
                  <span className="text-amber-500"> {system.journal.redactedCount} secret-looking quer{system.journal.redactedCount === 1 ? 'y was' : 'ies were'} redacted and never stored.</span>
                )}
              </p>
              {words.length === 0 ? (
                <div className="text-center py-16 text-zinc-500 space-y-3">
                  <BookOpen className="w-8 h-8 mx-auto text-zinc-600" />
                  <p className="text-xs">Empty notebook. Press Enter on a search to note it.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {words.map(w => (
                    <div
                      key={w.word}
                      onClick={() => onSelectQuery(w.word)}
                      className="p-3 bg-zinc-900 border border-zinc-800 rounded hover:border-[#4F8CFF]/80 cursor-pointer transition-all flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Search className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                        <span className="text-[#4F8CFF] font-bold font-mono select-all truncate">{w.word}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${w.everFound ? 'bg-emerald-950/60 text-emerald-400' : 'bg-red-950/50 text-red-400'}`}>
                          {w.everFound ? 'found' : 'never found'}
                        </span>
                      </div>
                      <div className="text-right shrink-0 font-mono text-[10px] text-zinc-500">
                        <div><span className="text-zinc-300 font-bold">{w.searchCount}</span> search{w.searchCount !== 1 ? 'es' : ''} · last hits: <span className="text-zinc-300">{w.lastTotalFound}</span></div>
                        <div className="text-zinc-600">{timeAgo(w.lastSearchedAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'history' && (
            <div className="space-y-2.5">
              {entries.length === 0 ? (
                <div className="text-center py-16 text-zinc-500 space-y-3">
                  <Activity className="w-8 h-8 mx-auto text-zinc-600" />
                  <p className="text-xs">No journal entries yet. Committed searches land here.</p>
                </div>
              ) : (
                entries.map(entryRow)
              )}
            </div>
          )}

          {tab === 'system' && system && (
            <div className="space-y-5">
              {/* CPU + memory: real values from os.cpus()/process.memoryUsage() */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                <div className="p-3 bg-[#1A1C1E] border border-zinc-800 rounded">
                  <span className="block text-zinc-500 text-[10px] uppercase tracking-wider">CPU cores</span>
                  <div className="text-white text-base font-extrabold font-mono mt-1">{system.cpu.cores}</div>
                  <span className="text-[9px] text-zinc-500 block mt-0.5 truncate" title={system.cpu.model}>{system.cpu.model}</span>
                </div>
                <div className="p-3 bg-[#1A1C1E] border border-zinc-800 rounded">
                  <span className="block text-zinc-500 text-[10px] uppercase tracking-wider">Load avg (1m)</span>
                  <div className="text-white text-base font-extrabold font-mono mt-1">{system.cpu.loadavg[0]}</div>
                  <span className="text-[9px] text-zinc-500 block mt-0.5">5m {system.cpu.loadavg[1]} · 15m {system.cpu.loadavg[2]}</span>
                </div>
                <div className="p-3 bg-[#1A1C1E] border border-zinc-800 rounded">
                  <span className="block text-zinc-500 text-[10px] uppercase tracking-wider">Memory (RSS)</span>
                  <div className="text-white text-base font-extrabold font-mono mt-1">{formatMB(system.memory.rss)}</div>
                  <span className="text-[9px] text-zinc-500 block mt-0.5">heap {formatMB(system.memory.heapUsed)} / {formatMB(system.memory.heapTotal)}</span>
                </div>
                <div className="p-3 bg-[#1A1C1E] border border-zinc-800 rounded">
                  <span className="block text-zinc-500 text-[10px] uppercase tracking-wider">Index</span>
                  <div className="text-white text-base font-extrabold font-mono mt-1">{system.index.lines.toLocaleString()}</div>
                  <span className="text-[9px] text-zinc-500 block mt-0.5">lines · {system.index.files.toLocaleString()} files · {system.index.repos} repos · {formatMB(system.index.shardBytes)} shards</span>
                </div>
              </div>

              {/* Search averages: measured from the journal */}
              <div className="p-3.5 bg-[#1A1C1E] border border-zinc-800 rounded space-y-2">
                <div className="flex items-center gap-1.5 text-white text-xs font-semibold">
                  <Server className="w-3.5 h-3.5 text-[#4F8CFF]" />
                  <span>Search timings (measured averages from the journal)</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center font-mono">
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase">Mirror</div>
                    <div className="text-white font-bold">{system.search.mirrorAvgMs > 0 ? `${system.search.mirrorAvgMs} ms` : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase">Semantic</div>
                    <div className="text-white font-bold">{system.search.semanticAvgMs > 0 ? `${system.search.semanticAvgMs} ms` : '—'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-zinc-500 uppercase">Live</div>
                    <div className="text-white font-bold">{system.search.liveAvgMs > 0 ? `${system.search.liveAvgMs} ms` : '—'}</div>
                  </div>
                </div>
                <p className="text-[9px] text-zinc-600">
                  {system.search.totalSearches} committed search(es) journaled. Values shown as “—” have not been measured yet.
                </p>
              </div>

              {/* Journal health */}
              <div className="p-3.5 bg-[#1A1C1E] border border-zinc-800 rounded text-[11px] text-zinc-400 space-y-1">
                <div className="flex items-center gap-1.5 text-white text-xs font-semibold">
                  <NotebookPen className="w-3.5 h-3.5 text-[#4F8CFF]" />
                  <span>Journal health</span>
                </div>
                <div className="font-mono text-[10px]">
                  {system.journal.enabled
                    ? system.journal.breakerTripped
                      ? 'BREAKER TRIPPED — journaling disabled after repeated write failures (search unaffected).'
                      : `active · ${system.journal.wordCount} words · ${system.journal.entryCount} entries · ${system.journal.redactedCount} redacted`
                    : 'disabled via JOURNAL_ENABLED=false'}
                </div>
                <div className="font-mono text-[10px] text-zinc-600">
                  node {system.process.node} · {system.process.platform} · up {Math.floor(system.process.uptimeSec / 60)}m
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[#2A2C2E] bg-[#1A1C20] flex items-center justify-between text-[10px] text-zinc-500">
          <div className="flex items-center gap-1">
            <Download className="w-3 h-3 text-[#4F8CFF]" />
            <span>Notebook lives in .cache/journal — local only, secret-free by construction.</span>
          </div>
          <span>v1.1.0</span>
        </div>
      </div>
    </div>
  );
}
