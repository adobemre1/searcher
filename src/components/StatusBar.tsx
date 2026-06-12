import React from 'react';
import RateGauge from './RateGauge';
import { RateLimits, RepoInfo, SystemMetrics } from '../api';
import { Wifi, WifiOff, HardDrive, NotebookPen } from 'lucide-react';

interface StatusBarProps {
  limits: RateLimits | null;
  repos: RepoInfo[];
  isSearching: boolean;
  isOnline: boolean;
  journal: SystemMetrics['journal'] | null;
  onOpenNotebook: () => void;
}

export default function StatusBar({ limits, repos, isSearching, isOnline, journal, onOpenNotebook }: StatusBarProps) {
  const indexedRepos = repos.filter(r => r.fileCount !== undefined && r.fileCount > 0);
  const totalFiles = indexedRepos.reduce((sum, r) => sum + (r.fileCount || 0), 0);
  const totalLines = indexedRepos.reduce((sum, r) => sum + (r.lineCount || 0), 0);

  const totalRawSize = indexedRepos.reduce((sum, r) => sum + (r.size || 0), 0);
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const journalAmber = journal !== null && (!journal.enabled || journal.breakerTripped);

  return (
    <div className="w-full bg-[#1E1F20] border-t border-[#2A2C2E] px-4 py-2 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs select-none">
      <div className="flex flex-wrap items-center gap-4 text-gray-500 font-mono text-[10px]">
        <div className="flex items-center gap-1.5 hover:text-white transition-colors">
          <HardDrive className="w-3.5 h-3.5 text-[#4F8CFF]" />
          <span>INDEXED:</span>
          <strong className="text-gray-300">{totalFiles.toLocaleString()} files</strong>
          <span className="text-zinc-700">|</span>
          <strong className="text-gray-300">{totalLines.toLocaleString()} lines</strong>
          <span className="text-zinc-700">|</span>
          <strong className="text-gray-300">{formatSize(totalRawSize)}</strong>
        </div>

        {/* Found-words notebook badge */}
        <button
          onClick={onOpenNotebook}
          className={`flex items-center gap-1.5 transition-colors ${journalAmber ? 'text-amber-500' : 'hover:text-white'}`}
          title={
            journal === null
              ? 'Notebook'
              : journal.breakerTripped
                ? 'Journal breaker tripped — journaling disabled (search unaffected)'
                : journal.enabled
                  ? `${journal.wordCount} noted words · ${journal.entryCount} entries`
                  : 'Journal disabled via JOURNAL_ENABLED=false'
          }
        >
          <NotebookPen className={`w-3.5 h-3.5 ${journalAmber ? 'text-amber-500' : 'text-[#4F8CFF]'}`} />
          <span>NOTEBOOK:</span>
          <strong className="text-gray-300">
            {journal === null ? '—' : journalAmber ? 'off' : `${journal.wordCount} words`}
          </strong>
        </button>

        <div className="flex items-center gap-1.5">
          {isOnline ? (
            <span className="text-emerald-500 font-bold flex items-center gap-1 text-[9px]">
              <Wifi className="w-3 h-3 text-emerald-500" />
              ONLINE
            </span>
          ) : (
            <span className="text-amber-500 font-bold flex items-center gap-1 text-[9px]">
              <WifiOff className="w-3 h-3 text-amber-500" />
              OFFLINE — mirror search still works
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <RateGauge limits={limits} />
      </div>
    </div>
  );
}
