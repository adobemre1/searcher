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
      <div className="bg-[#0F1115] p-2.5 rounded border border-[#2A2C2E] overflow-x-auto select-all whitespace-pre text-[#C0C0C0]">
        {isExpanded && match.before && (
          <div className="flex gap-4 select-none opacity-50 hover:opacity-100 transition-opacity">
            <span className="w-6 text-right select-none text-zinc-750">{match.lineNumber - 1}</span>
            <HighlightedLine text={match.before} ranges={[]} />
          </div>
        )}

        <div className="flex gap-4">
          <span className="w-6 text-right select-none text-[#4F8CFF] font-semibold">{match.lineNumber}</span>
          <HighlightedLine text={match.line} ranges={match.matchRanges} />
        </div>

        {isExpanded && match.after && (
          <div className="flex gap-4 select-none opacity-50 hover:opacity-100 transition-opacity">
            <span className="w-6 text-right select-none text-zinc-750">{match.lineNumber + 1}</span>
            <HighlightedLine text={match.after} ranges={[]} />
          </div>
        )}
      </div>
    </div>
  );
}

function HighlightedLine({ text, ranges }: { text: string; ranges: MatchRange[] }) {
  // Fallback tokenizer for regular unhighlighted blocks
  const tokenizeLine = (str: string, baseKey: string): React.ReactNode[] => {
    const trimmed = str.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      return [<span key={`${baseKey}-comment`} className="text-zinc-500 italic">{str}</span>];
    }

    const tokenRegex = /(\/\/.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|import|export|class|def|if|else|for|while|try|except|catch|from|import|interface|type)\b|[a-zA-Z_]\w*(?=\()|\d+|\w+|[^\s\w]+|\s+)/g;
    const items: React.ReactNode[] = [];
    let matchIdx = 0;
    let m;
    
    while ((m = tokenRegex.exec(str)) !== null) {
      const val = m[0];
      if (!val) continue;

      const subKey = `${baseKey}-${matchIdx++}`;
      if (val.startsWith('//') || val.startsWith('/*')) {
        items.push(<span key={subKey} className="text-zinc-500 italic">{val}</span>);
      } else if (val.startsWith('"') || val.startsWith("'") || val.startsWith('`')) {
        items.push(<span key={subKey} className="text-[#E7A870]">{val}</span>);
      } else if (/^(?:const|let|var|function|return|import|export|class|def|if|else|for|while|try|except|catch|from|import|interface|type)$/.test(val)) {
        items.push(<span key={subKey} className="text-[#F1759F] font-bold">{val}</span>);
      } else if (/[a-zA-Z_]\w*(?=\()/.test(val)) {
        items.push(<span key={subKey} className="text-[#6EA5FF]">{val}</span>);
      } else if (/^\d+$/.test(val)) {
        items.push(<span key={subKey} className="text-[#F1A2A2]">{val}</span>);
      } else {
        items.push(<span key={subKey} className="text-[#E3E3E3]">{val}</span>);
      }
    }

    return items.length > 0 ? items : [<span key={`${baseKey}-fallback`}>{str}</span>];
  };

  if (!ranges || ranges.length === 0) {
    return <span>{tokenizeLine(text, 'unmarked')}</span>;
  }

  const elements: React.ReactNode[] = [];
  let lastIndex = 0;

  // Sort ranges to process sequentially
  const sortedRanges = [...ranges].sort((a, b) => a.start - b.start);

  sortedRanges.forEach((range, i) => {
    // Normal text segment
    if (range.start > lastIndex) {
      const rawSegment = text.substring(lastIndex, range.start);
      elements.push(...tokenizeLine(rawSegment, `seg-${i}`));
    }
    // Highlighted match section with elegant neon blue underlined style
    const end = range.start + range.length;
    elements.push(
      <mark 
        key={`match-${i}`} 
        className="bg-[#4F8CFF]/20 text-[#D2E3FC] border-b-2 border-[#4F8CFF] px-0.5 font-bold"
      >
        {text.substring(range.start, end)}
      </mark>
    );
    lastIndex = end;
  });

  // Remainder segment
  if (lastIndex < text.length) {
    const rawEnd = text.substring(lastIndex);
    elements.push(...tokenizeLine(rawEnd, 'seg-end'));
  }

  return <span>{elements}</span>;
}
