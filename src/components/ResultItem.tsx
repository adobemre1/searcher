import React from 'react';
import { SearchResult, MatchRange } from '../api';
import { Copy, ArrowUpRight, ChevronDown, ChevronUp } from 'lucide-react';

interface ResultItemProps {
  key?: any;
  match: SearchResult;
  isExpanded: boolean;
  toggleExpand: () => void;
  q: string;
}

export default function ResultItem({ match, isExpanded, toggleExpand, q }: ResultItemProps) {
  const lineUrl = `https://github.com/${match.owner}/${match.repo}/blob/default/${match.path}#L${match.lineNumber}`;

  const copyPathToClipboard = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(match.path);
  };

  return (
    <div className="p-3 hover:bg-[#15171B] transition-colors leading-relaxed font-mono text-xs text-[#E3E3E3]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
        {/* file path and line number */}
        <div className="flex items-center gap-2 truncate">
          <span className="text-[#4F8CFF] font-semibold">L{match.lineNumber}</span>
          <span className="text-gray-500">in</span>
          <span className="text-[#E3E3E3] font-medium truncate" title={match.path}>
            {match.path}
          </span>
          
          <button
            onClick={copyPathToClipboard}
            className="text-gray-550 hover:text-white p-1 rounded hover:bg-zinc-805"
            title="Copy path to clipboard"
          >
            <Copy className="un-icon w-3 h-3" />
          </button>
        </div>

        {/* links & tools */}
        <div className="flex items-center gap-3 shrink-0">
          {(match.before || match.after) && (
            <button
              onClick={toggleExpand}
              className="px-2 py-0.5 rounded bg-zinc-800 text-gray-400 hover:text-white flex items-center gap-1 text-[10px]"
            >
              <span>Context</span>
              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}

          <a
            href={lineUrl}
            target="_blank"
            referrerPolicy="no-referrer"
            className="text-[10px] text-gray-400 hover:text-[#4F8CFF] flex items-center gap-0.5 hover:underline"
          >
            <span>GitHub</span>
            <ArrowUpRight className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* MATCHED LINES WITH HIGHLIGHTING */}
      <div className="bg-[#0F1115] p-2.5 rounded border border-[#2A2C2E] overflow-x-auto select-all whitespace-pre">
        {isExpanded && match.before && (
          <div className="text-zinc-650 flex gap-4 select-none">
            <span className="w-6 text-right select-none text-zinc-700">{match.lineNumber - 1}</span>
            <span>{match.before}</span>
          </div>
        )}

        <div className="flex gap-4">
          <span className="w-6 text-right select-none text-zinc-500">{match.lineNumber}</span>
          <HighlightedLine text={match.line} ranges={match.matchRanges} />
        </div>

        {isExpanded && match.after && (
          <div className="text-zinc-650 flex gap-4 select-none">
            <span className="w-6 text-right select-none text-zinc-700">{match.lineNumber + 1}</span>
            <span>{match.after}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function HighlightedLine({ text, ranges }: { text: string; ranges: MatchRange[] }) {
  if (!ranges || ranges.length === 0) return <span>{text}</span>;

  const elements: React.ReactNode[] = [];
  let lastIndex = 0;

  // Sort ranges to process sequentially
  const sortedRanges = [...ranges].sort((a, b) => a.start - b.start);

  sortedRanges.forEach((range, i) => {
    // Normal text segment
    if (range.start > lastIndex) {
      elements.push(<span key={`text-${i}`}>{text.substring(lastIndex, range.start)}</span>);
    }
    // Highlighted match section
    const end = range.start + range.length;
    elements.push(
      <mark key={`mark-${i}`} className="bg-yellow-400 text-black px-0.5 rounded font-bold">
        {text.substring(range.start, end)}
      </mark>
    );
    lastIndex = end;
  });

  // Remainder segment
  if (lastIndex < text.length) {
    elements.push(<span key="text-last">{text.substring(lastIndex)}</span>);
  }

  return <span>{elements}</span>;
}
