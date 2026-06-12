import fs from 'fs';
import path from 'path';
import unzipper from 'unzipper';
import {
  EXCLUDED_DIRS,
  EXCLUDED_FILES,
  EXCLUDED_EXTENSIONS,
  MAX_FILES_PER_REPO,
  MAX_TEXT_SIZE_BYTES_PER_REPO,
  MAX_SINGLE_FILE_SIZE_BYTES
} from './config.js';

export interface SkippedStats {
  excluded: number;
  binary: number;
  oversize: number;
  budget: number;
  empty: number;
}

export interface ParsedFile {
  path: string;
  lines: string[];
}

export interface ExtractionResult {
  files: ParsedFile[];
  skipped: SkippedStats;
  totalFileCount: number;
  totalTextSizeBytes: number;
}

/**
 * Checks if a relative file path matches user exclusions.
 */
export function isExcluded(relativeFilePath: string): boolean {
  const parts = relativeFilePath.split(/[\\/]/);
  
  // 1. Check if any path segment matches excluded directories
  for (const part of parts) {
    if (EXCLUDED_DIRS.includes(part)) {
      return true;
    }
  }

  const fileName = parts[parts.length - 1];
  if (!fileName) return true;

  // 2. Check if the file name matches file exclusion patterns
  for (const pattern of EXCLUDED_FILES) {
    if (pattern.startsWith('*.')) {
      const ext = pattern.substring(2);
      if (fileName.endsWith('.' + ext)) {
        return true;
      }
    } else if (fileName === pattern) {
      return true;
    }
  }

  // 3. Check file extension against known binary & large extensions
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex !== -1) {
    const ext = fileName.substring(dotIndex + 1).toLowerCase();
    if (EXCLUDED_EXTENSIONS.includes(ext)) {
      return true;
    }
  }

  return false;
}

/**
 * Parses buffer content into lines with binary sniffing and UTF-8 decoding containing latin1 fallback.
 */
export function parseFileContent(buffer: Buffer): { lines: string[] | null; isBinary: boolean } {
  if (buffer.length === 0) {
    return { lines: [], isBinary: false };
  }

  // Sniff first 8 KB for NUL bytes to quickly reject binary formats
  const sniffLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < sniffLength; i++) {
    if (buffer[i] === 0) {
      return { lines: null, isBinary: true };
    }
  }

  // Attempt UTF-8 decode. fallback to Iso-8859-1 (latin1) if it contains weird bytes
  let text = '';
  try {
    text = buffer.toString('utf8');
    // If it contains a lot of replacement characters, attempt latin-1
    const replacementCharCount = (text.match(/\uFFFD/g) || []).length;
    if (replacementCharCount > text.length * 0.05) {
      text = buffer.toString('binary'); // native ISO-8859-1 alias in Buffer
    }
  } catch {
    text = buffer.toString('binary');
  }

  // Split lines and truncate any individual line exceeding 500 characters
  // Expose truncate symbol in UI
  const rawLines = text.split(/\r?\n/);
  const processedLines = rawLines.map(line => {
    if (line.length > 500) {
      return line.substring(0, 500) + '…⟨truncated⟩';
    }
    return line;
  });

  return { lines: processedLines, isBinary: false };
}

/**
 * Performs zipball extraction of a single repo following the exact HC-10 and budget specifications.
 */
export async function extractAndParseZip(zipPath: string): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    files: [],
    skipped: {
      excluded: 0,
      binary: 0,
      oversize: 0,
      budget: 0,
      empty: 0
    },
    totalFileCount: 0,
    totalTextSizeBytes: 0
  };

  if (!fs.existsSync(zipPath)) {
    throw new Error(`Zipfile does not exist at path: ${zipPath}`);
  }

  const directory = await unzipper.Open.file(zipPath);

  // Sorting files to process deterministic files first (ignore directory nodes)
  const fileEntries = directory.files.filter(f => f.type === 'File');

  for (const entry of fileEntries) {
    // Top-level structure in GitHub zip releases contains a randomized directory e.g., owner-repo-sha/.
    // Strip this prefix.
    const pathParts = entry.path.split(/[\\/]/);
    if (pathParts.length <= 1) {
      // It's just the root directory or root-level file without structure
      continue;
    }
    const relativePath = pathParts.slice(1).join('/');

    if (!relativePath) {
      continue;
    }

    // Checking if file or folder is explicitly excluded
    if (isExcluded(relativePath)) {
      result.skipped.excluded++;
      continue;
    }

    // Skip empty files
    if (entry.uncompressedSize === 0) {
      result.skipped.empty++;
      continue;
    }

    // Skip oversized files larger than 1 MB limits (HC-10)
    if (entry.uncompressedSize > MAX_SINGLE_FILE_SIZE_BYTES) {
      result.skipped.oversize++;
      continue;
    }

    // Check budget limit thresholds before unpacking more files
    if (result.files.length >= MAX_FILES_PER_REPO || result.totalTextSizeBytes >= MAX_TEXT_SIZE_BYTES_PER_REPO) {
      result.skipped.budget++;
      continue;
    }

    // Read full uncompressed file buffer
    const buffer = await entry.buffer();
    
    // Sniff binary & decode content lines
    const { lines, isBinary } = parseFileContent(buffer);
    if (isBinary || !lines) {
      result.skipped.binary++;
      continue;
    }

    // Accumulate parsed content
    result.files.push({
      path: relativePath,
      lines
    });

    result.totalFileCount++;
    result.totalTextSizeBytes += buffer.length;
  }

  return result;
}
