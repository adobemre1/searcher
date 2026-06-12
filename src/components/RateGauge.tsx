import React, { useEffect, useState } from 'react';
import { RateLimits } from '../api';
import { Shield, Clock, Database, Search } from 'lucide-react';

interface RateGaugeProps {
  limits: RateLimits | null;
}

export default function RateGauge({ limits }: RateGaugeProps) {
  const [now, setNow] = useState(Date.now());

  // Poller feeds reset countdown changes recursively
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!limits) {
    return (
      <div className="text-zinc-650 text-[10px] italic">
        loading rate metrics...
      </div>
    );
  }

  const entries = Object.entries(limits);

  return (
    <div className="flex flex-wrap items-center gap-4 text-gray-400 font-sans text-xs select-none">
      {entries.map(([login, limitState]) => {
        if (!limitState) {
          return (
            <div key={login} className="flex items-center gap-1 text-[10px] text-zinc-650">
              <Shield className="w-3 h-3 text-zinc-700" />
              <span>{login}: public mode (60 req/hr)</span>
            </div>
          );
        }

        const core = limitState.core;
        const search = limitState.search;

        const formatCountdown = (resetEpoch: number) => {
          const resetMs = resetEpoch * 1000;
          const diffSec = Math.max(Math.floor((resetMs - now) / 1000), 0);
          if (diffSec === 0) return 'resetting';
          const mins = Math.floor(diffSec / 60);
          const secs = diffSec % 60;
          return `${mins}m ${secs}s`;
        };

        return (
          <div key={login} className="flex flex-wrap items-center gap-3 border-r border-[#2A2C2E] pr-4 last:border-0 last:pr-0">
            <span className="text-[#E3E3E3] font-bold text-[10px] uppercase tracking-wider">{login}:</span>
            
            {/* Core limit */}
            <div className="flex items-center gap-1.5 font-mono text-[10px]">
              <Database className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-gray-500">core:</span>
              <span className={core.remaining < 100 ? 'text-red-400 font-bold' : 'text-emerald-400'}>
                {core.remaining}/{core.limit}
              </span>
              <span className="text-zinc-650">·</span>
              <span className="text-zinc-600 flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {formatCountdown(core.reset)}
              </span>
            </div>

            {/* Search limit */}
            {search && (
              <div className="flex items-center gap-1.5 font-mono text-[10px]">
                <Search className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-gray-500">search:</span>
                <span className={search.remaining < 2 ? 'text-amber-500 font-bold' : 'text-emerald-400'}>
                  {search.remaining}/{search.limit}
                </span>
                <span className="text-zinc-650">·</span>
                <span className="text-zinc-600 flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  {formatCountdown(search.reset)}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
