import React, { useState } from 'react';
import { SearchResponse, SearchResult } from '../api';
import ResultItem from './ResultItem';
import { Sparkles, Terminal, FileText, LayoutList } from 'lucide-react';

interface ResultListProps {
  response: SearchResponse | null;
  isSearching: boolean;
  q: string;
}

export default function ResultList({ response, isSearching, q }: ResultListProps) {
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});

  if (isSearching) {
    return (
      <div className="flex-1 bg-[#0F1115] flex flex-col items-center justify-center p-8 text-gray-400 gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-r-transparent border-[#4F8CFF] animate-spin" />
        <span className="text-sm font-medium tracking-wide">Searching the workspace matching queries...</span>
      </div>
    );
  }

  if (!response) {
    // Standard onboarding state (when before search, §6)
    return (
      <div className="flex-1 bg-[#0F1115] flex flex-col items-center justify-center p-6 text-center select-none font-sans">
        <div className="max-w-md bg-[#1E1F20] border border-[#2A2C2E] p-8 rounded-lg shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-[3px] bg-[#4F8CFF]" />
          
          <div className="w-12 h-12 rounded bg-zinc-800 text-[#4F8CFF] flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-6 h-6" />
          </div>

          <h3 className="text-white text-base font-bold mb-2">Onboarding Checklist</h3>
          <p className="text-gray-400 text-xs mb-6 leading-relaxed">
            Follow these steps to search matching keywords across your repositories with zero API limit counts.
          </p>

          <ol className="text-left space-y-3.5 text-xs text-gray-300">
            <li className="flex gap-2">
              <span className="bg-[#4F8CFF] text-[#0F1115] w-5 h-5 rounded-full font-bold flex items-center justify-center shrink-0">1</span>
              <div>
                <strong className="text-white">Configure tokens</strong>
                <p className="text-gray-500 text-[10px]">Add PAT keys to `.env.local` for private repo access.</p>
              </div>
            </li>
            <li className="flex gap-2">
              <span className="bg-[#4F8CFF] text-[#0F1115] w-5 h-5 rounded-full font-bold flex items-center justify-center shrink-0">2</span>
              <div>
                <strong className="text-white">Trigger mirror index sync</strong>
                <p className="text-gray-500 text-[10px]">Refresh cache directories by pushing the top-right Sync button.</p>
              </div>
            </li>
            <li className="flex gap-2">
              <span className="bg-[#4F8CFF] text-[#0F1115] w-5 h-5 rounded-full font-bold flex items-center justify-center shrink-0">3</span>
              <div>
                <strong className="text-white">Search instantly offline</strong>
                <p className="text-gray-500 text-[10px]">Search keywords like <code className="text-[#4F8CFF]">danisman</code> near-instantly.</p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    );
  }

  const { results, pathMatches, totalFound, truncated, tookMs, apiCallsUsed, explanation } = response;

  if (results.length === 0 && pathMatches.length === 0) {
    return (
      <div className="flex-1 bg-[#0F1115] flex flex-col items-center justify-center p-6 text-center text-gray-550 select-none">
        <Terminal className="w-8 h-8 mb-2 text-zinc-650" />
        <span className="text-sm text-zinc-400 font-semibold mb-1">No matches found</span>
        <span className="text-xs text-zinc-550">Try modifying your folding parameters or spelling accuracy.</span>
      </div>
    );
  }

  // Group text results by repository
  const groupedResults: Record<string, SearchResult[]> = {};
  for (const r of results) {
    const key = `${r.owner}/${r.repo}`;
    if (!groupedResults[key]) {
      groupedResults[key] = [];
    }
    groupedResults[key].push(r);
  }

  return (
    <div className="flex-1 bg-[#0F1115] overflow-y-auto flex flex-col select-text">
      {/* 1. Header Toolbar */}
      <div className="sticky top-0 bg-[#0F1115] border-b border-[#2A2C2E] px-4 py-2 text-xs text-gray-400 flex flex-wrap items-center justify-between gap-2 z-10 font-mono">
        <div>
          <span className="text-white font-semibold">{totalFound}</span> results in <span className="text-white">{Object.keys(groupedResults).length}</span> repositories 
          {truncated && <span className="text-amber-500 ml-1"> (match results truncated to limit cap)</span>}
        </div>
        <div className="flex items-center gap-4">
          <span>took {tookMs} ms</span>
          <span className="bg-zinc-850 px-2 py-0.5 rounded text-[10px]">
            API Calls utilized: <strong className={apiCallsUsed > 0 ? 'text-amber-400 animate-pulse' : 'text-emerald-400'}>{apiCallsUsed}</strong>
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4 flex-1 max-w-full">
        {/* AI Semantic insights Explanation box */}
        {explanation && (
          <div className="bg-[#181C25] border border-[#3E65B3]/40 rounded p-4 relative overflow-hidden shadow-md">
            <div className="absolute top-0 left-0 w-1 h-full bg-[#4F8CFF]" />
            <div className="flex gap-2.5 items-start">
              <Sparkles className="w-4.5 h-4.5 text-[#4F8CFF] shrink-0 mt-0.5 animate-pulse" />
              <div className="space-y-1">
                <span className="block text-[10px] text-gray-400 font-mono uppercase tracking-wider font-bold">Genesis Quantum Code Semantic Insight</span>
                <p className="text-xs text-gray-200 font-sans leading-relaxed select-text">{explanation}</p>
              </div>
            </div>
          </div>
        )}

        {/* 2. Pinned PathMatches Header Category (AC-04) */}
        {pathMatches.length > 0 && (
          <div className="bg-[#1E1F20] border border-[#2A2C2E] rounded">
            <div className="px-3 py-1.5 border-b border-[#2A2C2E] bg-zinc-850 flex items-center gap-2 text-xs font-semibold text-gray-300 font-mono">
              <FileText className="w-3.5 h-3.5 text-[#4F8CFF]" />
              <span>PINNED PATH MATCHES ({pathMatches.length})</span>
            </div>
            <div className="p-2.5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs font-mono">
              {pathMatches.map((pm, i) => (
                <a
                  key={i}
                  href={`https://github.com/${pm.owner}/${pm.repo}/blob/default/${pm.path}`}
                  target="_blank"
                  referrerPolicy="no-referrer"
                  className="p-2 bg-[#0F1115] border border-zinc-850 rounded hover:border-[#4F8CFF] flex flex-col text-[#E3E3E3] hover:text-white transition-colors"
                >
                  <span className="text-gray-500 text-[10px] uppercase font-bold">{pm.owner}/{pm.repo}</span>
                  <span className="truncate mt-1 text-[#E3E3E3] font-medium">{pm.path.split('/').pop()}</span>
                  <span className="text-[10px] text-zinc-600 truncate mt-0.5" title={pm.path}>{pm.path}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* 3. Text Code Segment Results Grouped */}
        {Object.entries(groupedResults).map(([key, fileMatches]) => (
          <div key={key} className="border border-[#2A2C2E] bg-[#1E1F20] rounded shadow">
            {/* Repo Title Header bar */}
            <div className="px-3 py-2 border-b border-[#2A2C2E] bg-zinc-850 text-xs font-semibold text-[#E3E3E3] flex items-center justify-between font-mono">
              <div className="flex items-center gap-1.5">
                <LayoutList className="w-4 h-4 text-zinc-500" />
                <span className="text-[#4F8CFF] font-bold">{key}</span>
                <span className="text-gray-500">· {fileMatches.length} matching fragments</span>
              </div>
              <a
                href={`https://github.com/${key}`}
                target="_blank"
                referrerPolicy="no-referrer"
                className="text-[10px] text-zinc-500 hover:text-white underline"
              >
                open on github.com
              </a>
            </div>

            {/* Matching Rows */}
            <div className="divide-y divide-zinc-850">
              {fileMatches.map((match, idx) => (
                <ResultItem 
                  key={idx} 
                  match={match} 
                  isExpanded={expandedFiles[`${match.path}:${match.lineNumber}`] || false}
                  toggleExpand={() => {
                    const id = `${match.path}:${match.lineNumber}`;
                    setExpandedFiles({
                      ...expandedFiles,
                      [id]: !expandedFiles[id]
                    });
                  }}
                  q={q} 
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
