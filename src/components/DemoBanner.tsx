import React from 'react';
import { AccountInfo } from '../api.js';
import { AlertTriangle, Key } from 'lucide-react';

interface DemoBannerProps {
  accounts: AccountInfo[];
}

export default function DemoBanner({ accounts }: DemoBannerProps) {
  const missingTokenAccount = accounts.some(a => !a.hasToken);
  
  if (!missingTokenAccount) return null;

  return (
    <div className="w-full bg-amber-950/70 border-b border-amber-900/50 px-4 py-2 text-amber-500 text-[11px] font-sans flex items-center justify-between gap-3 select-none">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500 animate-pulse" />
        <div>
          <strong>Demo mode active.</strong> Some GitHub accounts lack a Personal Access Token (PAT). Syncing will fall back to public unauthenticated index bounds (60 core requests/hour limit).
        </div>
      </div>
      
      <div className="hidden md:flex items-center gap-1 bg-[#1E1F20] border border-[#2A2C2E] text-gray-300 font-mono text-[10px] px-2 py-0.5 rounded shadow">
        <Key className="w-3 h-3 text-amber-500" />
        <span>Add GITHUB_TOKEN keys inside .env.local</span>
      </div>
    </div>
  );
}
