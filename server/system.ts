import os from 'os';
import fs from 'fs';
import path from 'path';
import { INDEX_DIR } from './config.js';
import { globalRepoRegistry } from './sync.js';
import { getAverages, getJournalHealth, JournalAverages, JournalHealth } from './journal.js';

// ---------------------------------------------------------------------------
// System metrics — measured values only. If a number cannot be measured on
// this machine it is not shown. This module replaces an earlier panel that
// invented hardware specs and simulated per-core loads.
// ---------------------------------------------------------------------------

export interface SystemMetrics {
  cpu: {
    cores: number;
    model: string;
    loadavg: number[]; // 1, 5, 15 min
  };
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  index: {
    repos: number;
    files: number;
    lines: number;
    shardBytes: number;
  };
  search: JournalAverages;
  journal: JournalHealth;
  process: {
    node: string;
    platform: string;
    uptimeSec: number;
  };
}

let indexStatsCache: { at: number; repos: number; files: number; lines: number; shardBytes: number } | null = null;
const INDEX_STATS_TTL_MS = 5000;

function getIndexStats() {
  const now = Date.now();
  if (indexStatsCache && now - indexStatsCache.at < INDEX_STATS_TTL_MS) {
    return indexStatsCache;
  }

  let repos = 0;
  let files = 0;
  let lines = 0;
  for (const entry of Object.values(globalRepoRegistry)) {
    if (entry.status === 'indexed') {
      repos++;
      files += entry.fileCount || 0;
      lines += entry.lineCount || 0;
    }
  }

  let shardBytes = 0;
  try {
    if (fs.existsSync(INDEX_DIR)) {
      for (const f of fs.readdirSync(INDEX_DIR)) {
        if (f.endsWith('.json.gz')) {
          shardBytes += fs.statSync(path.join(INDEX_DIR, f)).size;
        }
      }
    }
  } catch {}

  indexStatsCache = { at: now, repos, files, lines, shardBytes };
  return indexStatsCache;
}

export function getSystemMetrics(): SystemMetrics {
  const cpus = os.cpus();
  const mem = process.memoryUsage();
  const idx = getIndexStats();

  return {
    cpu: {
      cores: cpus.length,
      model: cpus[0]?.model || 'unknown',
      loadavg: os.loadavg().map(v => parseFloat(v.toFixed(2)))
    },
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal
    },
    index: {
      repos: idx.repos,
      files: idx.files,
      lines: idx.lines,
      shardBytes: idx.shardBytes
    },
    search: getAverages(),
    journal: getJournalHealth(),
    process: {
      node: process.version,
      platform: process.platform,
      uptimeSec: Math.floor(process.uptime())
    }
  };
}
