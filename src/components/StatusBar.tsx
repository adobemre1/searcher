import React from 'react';
import RateGauge from './RateGauge';
import { RateLimits, RepoInfo } from '../api';
import { Activity, Wifi, WifiOff, HardDrive } from 'lucide-react';

interface StatusBarProps {
  limits: RateLimits | null;
  repos: RepoInfo[];
  isSearching: boolean;
  isOnline: boolean;
}

export default function StatusBar({ limits, repos, isSearching, isOnline }: StatusBarProps) {
  // Sum overall stats cached locally
  const indexedRepos = repos.filter(r => r.fileCount !== undefined && r.fileCount > 0);
  const totalFiles = indexedRepos.reduce((sum, r) => sum + (r.fileCount || 0), 0);
  const totalLines = indexedRepos.reduce((sum, r) => sum + (r.lineCount || 0), 0);
  
  // Sum file size on disk
  const totalRawSize = indexedRepos.reduce((sum, r) => sum + (r.size || 0), 0);
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="w-full bg-[#1E1F20] border-t border-[#2A2C2E] px-4 py-2 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs select-none">
      {/* Local Index Database Metadata */}
      <div className="flex flex-wrap items-center gap-4 text-gray-500 font-mono text-[10px]">
        <div className="flex items-center gap-1.5 hover:text-white transition-colors">
          <HardDrive className="w-3.5 h-3.5 text-[#4F8CFF]" />
          <span>INDEXED:</span>
          <strong className="text-gray-300">{totalFiles.toLocaleString()} files</strong>
          <span className="text-zinc-700">|</span>
          <strong className="text-gray-300">{totalLines.toLocaleString()} lines</strong>
          <span className="text-zinc-700">|</span>
          <strong className="text-gray-350">{formatSize(totalRawSize)}</strong>
        </div>

        {/* Offline capable indicator */}
        <div className="flex items-center gap-1.5">
          {isOnline ? (
            <span className="text-emerald-500 font-bold flex items-center gap-1 text-[9px]">
              <Wifi className="w-3 h-3 text-emerald-500 animate-pulse" />
              ONLINE — MIRROR SYNC ACTIVE
            </span>
          ) : (
            <span className="text-amber-500 font-bold flex items-center gap-1 text-[9px]">
              <WifiOff className="w-3 h-3 text-amber-500" />
              OFFLINE SEARCH GURANTEE ACTIVE
            </span>
          )}
        </div>
      </div>

      {/* Mounting Circular Rate Meters */}
      <div className="flex items-center gap-3 shrink-0">
        <RateGauge limits={limits} />
      </div>
    </div>
  );
}
