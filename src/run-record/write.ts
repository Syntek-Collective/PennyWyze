import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';

import type { RunRecord } from './schema.js';

/**
 * Writes a run record to the path the user named with --json-out.
 *
 * Only ever writes where it was told to, and creates the containing folder if
 * that folder doesn't exist yet — same contract as --capture-misses. Pretty
 * printed with a trailing newline, because these files get committed as CI
 * baselines and read in diffs.
 *
 * Note for anyone recommending that: a record holds the full text of every
 * missed question, so it is more sensitive than --capture-misses, which stores
 * only the answer and the expected label. Overwrites without asking — the
 * caller checks the path first (see output-path.ts).
 */
export const writeRunRecord = (filePath: string, record: RunRecord): void => {
  const dir = dirname(filePath);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
};
