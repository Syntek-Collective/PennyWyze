import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

import {
  checkOutputPath,
  prepareOutputPath,
} from '../../src/run-record/output-path.js';
import { writeRunRecord } from '../../src/run-record/write.js';
import type { RunRecord } from '../../src/run-record/schema.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pennywyze-out-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('checkOutputPath', () => {
  const inputs = (base: string) => ({
    prompt: join(base, 'prompt.md'),
    dataset: join(base, 'data.jsonl'),
  });

  it('refuses to overwrite the dataset', () => {
    // Writing the record over the dataset destroys the dataset, and the audit
    // has already run by then — the user loses the file and the run.
    expect(() =>
      checkOutputPath(join(dir, 'data.jsonl'), inputs(dir)),
    ).toThrow(/overwrite your dataset/);
  });

  it('refuses to overwrite the prompt', () => {
    expect(() => checkOutputPath(join(dir, 'prompt.md'), inputs(dir))).toThrow(
      /overwrite your prompt/,
    );
  });

  it('recognises the same file reached by a different path', () => {
    // './data.jsonl' and an absolute path to it are the same file.
    const relativeish = join(dir, 'sub', '..', 'data.jsonl');

    expect(() => checkOutputPath(relativeish, inputs(dir))).toThrow(
      /overwrite your dataset/,
    );
    expect(resolve(relativeish)).toBe(resolve(inputs(dir).dataset));
  });

  it('allows any other path', () => {
    expect(() =>
      checkOutputPath(join(dir, 'run.json'), inputs(dir)),
    ).not.toThrow();
  });

  it('allows overwriting a previous run record', () => {
    // Re-running an audit to the same path is normal and should replace it.
    const path = join(dir, 'run.json');
    writeFileSync(path, '{}');

    expect(() => checkOutputPath(path, inputs(dir))).not.toThrow();
  });
});

describe('prepareOutputPath', () => {
  it('creates the folder before the audit runs', () => {
    prepareOutputPath(join(dir, 'reports', 'nested', 'run.json'));

    expect(existsSync(join(dir, 'reports', 'nested'))).toBe(true);
  });

  it('is fine when the folder already exists', () => {
    expect(() => prepareOutputPath(join(dir, 'run.json'))).not.toThrow();
    expect(() => prepareOutputPath(join(dir, 'run.json'))).not.toThrow();
  });

  it('throws on a path it cannot create, so the caller can report it', () => {
    // A file where a folder needs to be. The CLI turns this into a clean
    // message before spending anything on an audit.
    const blocker = join(dir, 'not-a-folder');
    writeFileSync(blocker, 'x');

    expect(() => prepareOutputPath(join(blocker, 'run.json'))).toThrow();
  });
});

describe('writeRunRecord failure', () => {
  it('throws rather than exiting, so the CLI can report it cleanly', () => {
    // Writing to a path that is a directory fails at the filesystem level.
    const record = { schemaVersion: 1 } as unknown as RunRecord;

    expect(() => writeRunRecord(dir, record)).toThrow();
  });
});
