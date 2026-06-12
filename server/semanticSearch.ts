import { GoogleGenAI } from '@google/genai';
import { QuantumEngine } from './quantumEngine.js';
import { parseBooleanQuery } from './searchIndex.js';
import { foldTurkish } from './fold.ts';
import { maskSecrets } from './mask.ts';

export interface IndexedFile {
  owner: string;
  repo: string;
  path: string;
  lines: string[];
  foldedLines: string[];
}

export interface SemanticMatchResult {
  owner: string;
  repo: string;
  path: string;
  score: number;
  matchedLines: Array<{
    lineNumber: number;
    text: string;
    score: number;
  }>;
}

export interface SemanticSearchResponse {
  results: SemanticMatchResult[];
  tookMs: number;
  totalFound: number;
  explanation?: string;
}

// Common codebase programming stopwords list
const CODE_STOPWORDS = new Set([
  'const', 'let', 'var', 'function', 'import', 'from', 'return', 'class',
  'public', 'private', 'interface', 'export', 'default', 'this', 'false',
  'true', 'null', 'undefined', 'async', 'await', 'package',
  'string', 'number', 'boolean', 'void', 'new', 'require', 'module'
]);

/**
 * Tokenizes a string into a list of word tokens.
 * Folds Turkish diacritics and filters short noise tokens.
 */
function tokenize(text: string): string[] {
  const folded = foldTurkish(text).toLowerCase();
  return folded.split(/[^a-z0-9_]+/).filter(t => t.length > 2);
}

/**
 * Executes a fast, local semantic similarity search over the loaded memory index.
 * Uses the mathematical QuantumEngine.cosineSimilarity over TF-IDF term vectors.
 */
export function executeLocalSemanticSearch(
  memoryIndex: IndexedFile[],
  params: {
    q: string;
    accounts?: string[];
    repos?: string[];
    limit?: number;
    similarityThreshold?: number;
    pathBoost?: number;
    k1?: number; // BM25 term frequency saturation coefficient
    b?: number;  // BM25 document length normalization coefficient
    maxLineLength?: number;
  }
): { results: SemanticMatchResult[]; tookMs: number } {
  const startTime = Date.now();
  const limit = params.limit || 30;

  // Read calibratable tuning parameters with robust defaults
  const k1 = params.k1 !== undefined ? params.k1 : 1.2;
  const bMultiplier = params.b !== undefined ? params.b : 0.75;
  const pathBoostFactor = params.pathBoost !== undefined ? params.pathBoost : 0.25;
  const simThreshold = params.similarityThreshold !== undefined ? params.similarityThreshold : 0.1;
  const maxLineLength = params.maxLineLength !== undefined ? params.maxLineLength : 350;

  const query = params.q;
  const parsed = parseBooleanQuery(query, true, false);
  const qTokens = [...parsed.positiveTerms, ...parsed.exactPhrases];

  if (qTokens.length === 0) {
    return { results: [], tookMs: Date.now() - startTime };
  }

  // Pre-process filters
  const accountFilter = params.accounts && params.accounts.length > 0 ? new Set(params.accounts) : null;
  const repoFilter = params.repos && params.repos.length > 0 ? new Set(params.repos) : null;

  // Let's identify if we have mixed stopword & non-stopword tokens in query
  const hasNonStopwords = qTokens.some(tok => !CODE_STOPWORDS.has(tok));

  // Build a query counts vector with stopword de-prioritization
  const queryCounts: Record<string, number> = {};
  for (const tok of qTokens) {
    let weight = 1.0;
    // Down-penalty standard codebase keywords if other descriptive terms are present
    if (hasNonStopwords && CODE_STOPWORDS.has(tok)) {
      weight = 0.25;
    }
    queryCounts[tok] = (queryCounts[tok] || 0) + weight;
  }
  const uniqueQueryTokens = Object.keys(queryCounts);
  const qVector = uniqueQueryTokens.map(tok => queryCounts[tok]);

  const matches: SemanticMatchResult[] = [];

  for (const file of memoryIndex) {
    const key = `${file.owner}/${file.repo}`;
    if (accountFilter && !accountFilter.has(file.owner)) continue;
    if (repoFilter && !repoFilter.has(key)) continue;

    const fileWordCounts: Record<string, number> = {};
    for (const token of uniqueQueryTokens) {
      fileWordCounts[token] = 0;
    }

    const lineMatches: Array<{ lineNumber: number; text: string; score: number }> = [];

    // Scan file lines
    const lineCount = file.lines.length;
    for (let i = 0; i < lineCount; i++) {
      const originalLine = file.lines[i];
      // Skip excessively long/minified lines to guarantee execution clock constraints
      if (originalLine.length > maxLineLength) continue;

      const lineStr = file.foldedLines[i];

      // Exclude negative terms
      let skipLine = false;
      for (const neg of parsed.negativeTerms) {
        if (lineStr.includes(neg)) {
          skipLine = true;
          break;
        }
      }
      if (skipLine) continue;

      let lineHasQueryToken = false;
      const lineWordCounts: Record<string, number> = {};
      const averageLineLength = 60; // Expected code line model offset

      for (const token of uniqueQueryTokens) {
        if (lineStr.includes(token)) {
          lineHasQueryToken = true;
          const rawCount = (lineStr.split(token).length - 1);
          
          // Google-Grade BM25 Frequency Saturation tuning formula
          const lengthNormalizer = 1.0 - bMultiplier + bMultiplier * (lineStr.length / averageLineLength);
          const saturatedCount = (rawCount * (k1 + 1)) / (rawCount + k1 * lengthNormalizer);

          lineWordCounts[token] = saturatedCount;
          fileWordCounts[token] = (fileWordCounts[token] || 0) + saturatedCount;
        } else {
          lineWordCounts[token] = 0;
        }
      }

      if (lineHasQueryToken) {
        // Calculate line similarity score
        const lVector = uniqueQueryTokens.map(tok => lineWordCounts[tok]);
        try {
          const lScore = QuantumEngine.cosineSimilarity(qVector, lVector);
          if (lScore > 0.05) {
            lineMatches.push({
              lineNumber: i + 1,
              text: maskSecrets(originalLine),
              score: parseFloat(lScore.toFixed(4))
            });
          }
        } catch {
          // Guard for zero-length arrays or NaN
        }
      }
    }

    // Evaluate overall document match
    const fVector = uniqueQueryTokens.map(tok => fileWordCounts[tok]);
    let docScore = 0;
    try {
      docScore = QuantumEngine.cosineSimilarity(qVector, fVector);
    } catch {}

    // Include path token boost factor
    let pathBoost = 0;
    const pathTokens = tokenize(file.path);
    for (const qtok of uniqueQueryTokens) {
      if (pathTokens.includes(qtok)) {
        pathBoost += pathBoostFactor;
      }
    }

    const finalScore = docScore + pathBoost;

    if (finalScore > simThreshold) {
      lineMatches.sort((a, b) => b.score - a.score);

      matches.push({
        owner: file.owner,
        repo: file.repo,
        path: file.path,
        score: parseFloat(Math.min(finalScore, 1.0).toFixed(4)),
        matchedLines: lineMatches.slice(0, 5) // Top 5 lines
      });
    }
  }

  // Sort overall matching results descending by similarity scores
  matches.sort((a, b) => b.score - a.score);

  const tookMs = Date.now() - startTime;
  return {
    results: matches.slice(0, limit),
    tookMs
  };
}

/**
 * Explain search results natively using Google Gemini API or fall back to high-value static reasoning.
 */
export async function explainSemanticResults(
  query: string,
  results: SemanticMatchResult[]
): Promise<string> {
  const hasKey = !!process.env.GEMINI_API_KEY;

  if (!hasKey) {
    return "Using offline reasoning fallback mode. (Configure GEMINI_API_KEY for generative explanations). " +
      `Evaluated ${results.length} codebase matching candidate(s) under Turkish-folding TF-IDF vector space model. ` +
      "Highest relevance score: " + (results[0]?.score ? `${(results[0].score * 100).toFixed(1)}%` : '0%') + ".";
  }

  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    const contextResults = results.slice(0, 3).map(res => {
      const codeLinesSnippet = res.matchedLines.map(l => `Line ${l.lineNumber}: ${l.text}`).join('\n');
      return `File: ${res.owner}/${res.repo}/${res.path}\nRelevance: ${Math.round(res.score * 100)}%\nSnippet:\n${codeLinesSnippet}`;
    }).join('\n\n');

    const prompt = `You are a high-performance codebase assistant. Help the developer understand how the search results relate to their query.

Query: "${query}"

Top Search Match Contexts:
${contextResults}

Provide a concise, highly professional developer-focused summary (2-3 sentences) explaining where and how the query is addressed in these files. Use markdown formatting. Do not output path configurations or self-referential comments.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        systemInstruction: "You are an elite software architect explaining codebase query overlaps simply.",
        temperature: 0.2
      }
    });

    return response.text || "No AI summary could be constructed.";
  } catch (err: any) {
    return `AI Context Generation failed: ${err.message}. Showing offline results.`;
  }
}
