import React from 'react';
import { SyncStatus, triggerSync, RepoInfo } from '../api';
import { RefreshCw, Play, AlertTriangle, CheckCircle, Info, Archive } from 'lucide-react';

interface SyncPanelProps {
  status: SyncStatus | null;
  onRefresh: () => void;
  isOpen: boolean;
  onClose: () => void;
}

export default function SyncPanel({ status, onRefresh, isOpen, onClose }: SyncPanelProps) {
  if (!isOpen) return null;

  const handleTriggerSync = async (force = false) => {
    try {
      await triggerSync(force);
      onRefresh();
    } catch (err: any) {
      alert(`Sync trigger failed: ${err.message}`);
    }
  };

  const activeSync = status?.active || false;
  const reposList = status ? Object.values(status.repos) : [];
  
  // Calculate completion percentage
  const total = status?.totalRepos || 0;
  const completed = status?.completedRepos || 0;
  const perc = total > 0 ? Math.floor((completed / total) * 100) : 0;

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-[#1E1F20] border-l border-[#2A2C2E] shadow-2xl flex flex-col z-50 font-sans text-xs">
      {/* Title bar */}
      <div className="p-4 border-b border-[#2A2C2E] flex items-center justify-between bg-[#1E1F20]">
        <div className="flex items-center gap-2">
          <RefreshCw className={`w-4 h-4 text-[#4F8CFF] ${activeSync ? 'animate-spin' : ''}`} />
          <span className="font-bold text-white tracking-wide text-xs">MIRROR SYNCHRONIZATION</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white p-1 rounded hover:bg-[#0F1115]"
        >
          ✕
        </button>
      </div>

      {/* Sync global actions info */}
      <div className="p-4 border-b border-[#2A2C2E] space-y-3.5 bg-[#0F1115]">
        <div className="flex gap-2">
          <button
            onClick={() => handleTriggerSync(false)}
            disabled={activeSync}
            className="flex-1 bg-[#4F8CFF] hover:bg-[#3d70cc] text-[#0F1115] disabled:bg-zinc-800 disabled:text-gray-500 font-bold py-2 rounded text-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Sync All</span>
          </button>
          
          <button
            onClick={() => handleTriggerSync(true)}
            disabled={activeSync}
            className="border border-[#2C2E35] hover:border-zinc-700 hover:bg-zinc-900 disabled:border-zinc-800 disabled:text-zinc-650 font-semibold px-2 rounded text-xs text-[#E3E3E3] transition-colors"
            title="Ignore local caches and force-download everything"
          >
            Force Sync
          </button>
        </div>

        {/* Global Progress Bar */}
        {activeSync && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-[10px] text-gray-500 font-mono">
              <span>PROGRESS: {completed}/{total} repos</span>
              <span>{perc}%</span>
            </div>
            <div className="w-full bg-[#1E1F20] h-1.5 rounded overflow-hidden">
              <div 
                className="bg-[#4F8CFF] h-full transition-all duration-300"
                style={{ width: `${perc}%` }}
              />
            </div>
            {status?.currentRepo && (
              <div className="text-[10px] text-amber-500 truncate font-mono">
                syncing: {status.currentRepo}
              </div>
            )}
          </div>
        )}

        {!activeSync && (
          <div className="text-gray-500 text-[10px] leading-relaxed flex gap-2">
            <Info className="w-4 h-4 text-[#4F8CFF] shrink-0" />
            <span>
              Runs ETags checks to skip unmodified repos. Cold sync consumes &lt; 1% API quota because of indexing (F-7).
            </span>
          </div>
        )}
      </div>

      {/* Per-repository statuses list */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#2A2C2E] bg-[#1E1F20]">
        {reposList.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-[11px]">
            No synchronization logs active. Press Sync All to map repositories.
          </div>
        ) : (
          reposList.map((repo, i) => (
            <div key={i} className="p-3 space-y-1.5 hover:bg-[#15171B] transition-colors">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[#E3E3E3] truncate text-xs" title={repo.name}>
                  {repo.owner}/{repo.name}
                </span>
                
                {/* Status custom badge colors */}
                <StatusBadge status={repo.status} />
              </div>

              {/* Counts or metrics if successful */}
              {repo.status === 'indexed' && (
                <div className="flex flex-col gap-1 text-[10px] text-gray-500 font-mono">
                  <div className="flex items-center justify-between">
                    <span>Indexed Lines:</span>
                    <span className="text-[#E3E3E3]">{repo.lineCount.toLocaleString()} lines</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Files Loaded:</span>
                    <span className="text-[#E3E3E3]">{repo.fileCount} files</span>
                  </div>
                </div>
              )}

              {/* Skip file reason metrics */}
              {repo.skipped && (
                <div className="bg-[#0F1115] p-1.5 rounded text-[9px] text-[#8C8C8C] flex flex-wrap gap-x-2 gap-y-1 font-mono">
                  <span>Excluded: {repo.skipped.excluded}</span>
                  <span>Oversize: {repo.skipped.oversize}</span>
                  <span>Binary: {repo.skipped.binary}</span>
                  <span>Empty: {repo.skipped.empty}</span>
                  {repo.skipped.budget > 0 && <span className="text-red-500">Budget Limit Triggered!</span>}
                </div>
              )}

              {/* Error reporting */}
              {repo.error && (
                <div className="text-red-400 bg-red-950/40 p-1.5 rounded text-[9px] flex items-center gap-1 font-mono">
                  <AlertTriangle className="w-3 h-3 shrink-0 text-red-500" />
                  <span>{repo.error}</span>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: RepoInfo['status'] }) {
  let style = 'bg-zinc-800 text-zinc-400 border border-zinc-700';

  if (status === 'indexed') {
    style = 'bg-emerald-950 text-emerald-400 border border-emerald-800';
  } else if (status === 'queued') {
    style = 'bg-zinc-900 text-zinc-500 border border-transparent';
  } else if (status === 'checking' || status === 'downloading' || status === 'extracting') {
    style = 'bg-amber-950 text-amber-500 border border-amber-800 animate-pulse';
  } else if (status === 'failed') {
    style = 'bg-red-950 text-red-400 border border-red-800';
  } else if (status === 'up-to-date') {
    style = 'bg-zinc-800 text-emerald-500 border border-zinc-750';
  } else if (status === 'skipped-empty') {
    style = 'bg-zinc-900 text-gray-500 border border-zinc-800';
  }

  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold lowercase shrink-0 ${style}`}>
      {status}
    </span>
  );
}
