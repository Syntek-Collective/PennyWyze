#!/usr/bin/env node

import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { createRequire } from 'module';
import { Command } from 'commander';

import { loadGoldenDataset } from './golden-dataset/load-golden-dataset.js';
import { loadPrompt } from './golden-dataset/load-prompt.js';
import { runAudit, type AuditResult } from './audit.js';
import { printReport } from './report.js';
import { terminalProgress } from './progress.js';
import { decideVerdict } from './verdict.js';
import { buildRunRecord } from './run-record/build.js';
import { writeRunRecord } from './run-record/write.js';
import {
  checkOutputPath,
  prepareOutputPath,
} from './run-record/output-path.js';
import { fakeProvider } from './providers/fake-provider.js';
import { anthropicProvider } from './providers/anthropic-provider.js';
import { ANTHROPIC_MODELS } from './providers/anthropic-models.js';
import { calculateResultsCost, summarize } from './summarize.js';
import { exactMatchScorer } from './scorers/exact-match-scorer.js';

const program = new Command();

// Read at runtime rather than hardcoding, so `npm version` stays the single
// source of truth and --version can't drift from what was published.
// Resolves to the package root from both src/cli.ts and dist/cli.js.
const { version } = createRequire(import.meta.url)('../package.json') as {
  version: string;
};
// Derived from ANTHROPIC_MODELS so prices and IDs never drift out of sync.
// Object key order (opus, sonnet, haiku) is preserved here — that's why the
// report always prints in that order, without anyone sorting it explicitly.
const MODEL_IDS = Object.values(ANTHROPIC_MODELS).map(model => model.id);

// Opt-in only, via --capture-misses. Writes solely to the path the user named —
// never to a path we pick, because a relative default lands in whatever directory
// the command happened to be run from, which for an installed CLI is someone
// else's repo.
const saveMissFixtures = (misses: AuditResult[], filePath: string): void => {
  if (misses.length === 0) return;

  const dir = dirname(filePath);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Merge with whatever is already there so repeated runs accumulate
  // distinct misses instead of overwriting the file each time.
  const existingLines = existsSync(filePath)
    ? readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean)
    : [];

  const newLines = misses.map(m =>
    JSON.stringify({ answer: m.answer, expected: m.expected }),
  );
  const allLines = [...new Set([...existingLines, ...newLines])];

  writeFileSync(filePath, allLines.join('\n') + '\n');
};

// .version() belongs on the program itself — .command() returns the subcommand,
// so chaining it after would attach --version to `audit` instead of `pennywyze`.
program.name('pennywyze').version(version);

program
  .command('audit')
  .description(
    'Benchmark Claude tiers against your golden dataset to return the lowest-cost passing model with projected monthly savings',
  )
  .requiredOption('--prompt <filepath>', 'path to your prompt file')
  .requiredOption('--dataset <filepath>', 'path to your golden dataset file')
  .option(
    '--volume <message-count>',
    'number of messages your AI feature handles per month',
    '100000',
  )
  .option('--fake', 'use the FakeProvider instead of calling the real API')
  .option(
    '--pass-rate <percentage>',
    'minimum pass rate required, 0-100',
    '100',
  )
  .option(
    '--capture-misses <filepath>',
    'append wrong answers to this file as grader fixtures',
  )
  .option(
    '--current <model-id>',
    'the model you run today — savings are measured against it',
  )
  .option(
    '--json-out <filepath>',
    'also write the full run to this file as JSON, for CI or later comparison',
  )
  .action(async options => {
    // Convert flags from text into numbers — everything typed in a terminal arrives as a string
    const volume = Number(options.volume);
    if (Number.isNaN(volume) || volume <= 0){
      return program.error('Error: Volume must be a positive number.');
    }

    const passRate = Number(options.passRate);
    if (Number.isNaN(passRate) || passRate < 1 || passRate > 100){
      return program.error('Error: Pass rate must be a number between 1 and 100.');
    }
    const passBar = passRate / 100;

    // Validated here rather than silently ignored: a typo would otherwise fall
    // back to the priciest-tier baseline and quietly report the wrong savings.
    if (options.current && !MODEL_IDS.includes(options.current)) {
      return program.error(
        `Error: Unknown --current model '${options.current}'. Expected one of: ${MODEL_IDS.join(', ')}.`,
      );
    }

    // Load dataset and provider cleanly inside an error-handling boundary
    let prompt: string
    let dataset: ReturnType<typeof loadGoldenDataset>

    try {
      // Loaders throw descriptive errors for missing files, empty files, or invalid JSON lines
      prompt = loadPrompt(options.prompt);
      dataset = loadGoldenDataset(options.dataset);
    } catch (err:any) {
      // Intercept errors and print clean CLI messages without leaking Node stack traces
      return program.error(`Error: ${err.message}`)
    }

    // Checked before the audit runs: a bad --json-out path is a one-second fix
    // beforehand and a wasted paid audit afterwards.
    if (options.jsonOut) {
      try {
        checkOutputPath(options.jsonOut, {
          prompt: options.prompt,
          dataset: options.dataset,
        });
        prepareOutputPath(options.jsonOut);
      } catch (err) {
        return program.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const provider = options.fake ? fakeProvider : anthropicProvider;

    // Captured before the first call so the record says when the audit began,
    // not when it finished writing.
    const startedAt = new Date();

    const restoreCursor = () => {
      process.stdout.write('\x1b[?25h')
    }

    // Listen for Ctrl+C so the cursor is restored before exiting
    process.on('SIGINT', () => {
      restoreCursor(); // 1. Turn the cursor back on (\x1b[?25h)
      process.stdout.write('\n'); 
      process.exit(130); 
    })

    let results: AuditResult[]

    try {
      // Hides the cursor for the whole run; restoreCursor() in the finally block below brings it back
      process.stdout.write('\x1b[?25l')

      results = await runAudit(
        provider,
        dataset,
        prompt,
        MODEL_IDS,
        passBar, // as a fraction — early stopping needs it to know if a model can still recover
        exactMatchScorer,
        terminalProgress(),
      );
    } catch (err: any) {
      restoreCursor(); 

      const isNetworkOrTimeout = 
        err.name === 'APIConnectionError' || 
        err.name === 'APIConnectionTimeoutError' ||
        err.message?.toLowerCase().includes('timeout') ||
        err.message?.toLowerCase().includes('timed out');

      if (isNetworkOrTimeout) {
        return program.error('Error: Could not connect to Anthropic API. Check your network connection.');
      }

      // Tells TypeScript: execution stops here for any other error
      return program.error(`Error: ${err.message}`);
    } finally {
      // Runs no matter how the try block exits — success, error, or the early return above
      restoreCursor();
    }
    
    const summaries = summarize(
      results,
      MODEL_IDS,
      dataset.length,
      volume,
      passBar,
    );
    const auditCost = calculateResultsCost(results);
    if (options.captureMisses) {
      saveMissFixtures(
        results.filter(r => !r.pass),
        options.captureMisses,
      );
    }
    const currentModel: string | null = options.current ?? null;

    // The same decision the report prints — computed once, so the file and the
    // terminal can never disagree about who won.
    // Decided once here, then handed to both consumers, so the printed
    // verdict and the saved one cannot disagree.
    const verdict = decideVerdict(
      summaries,
      ...(currentModel ? ([currentModel] as const) : []),
    );

    printReport(summaries, auditCost, dataset.length, verdict);

    if (options.jsonOut) {
      try {
        writeRunRecord(
          options.jsonOut,
          buildRunRecord({
            startedAt,
            toolVersion: version,
            prompt,
            dataset,
            passRate,
            volume,
            // Hardcoded because exact-match is the only grader there is.
            // Becomes the selected grader's name once there is a choice.
            grader: 'exact',
            currentModel,
            models: summaries,
            verdict,
            auditCostUsd: auditCost,
          }),
        );
      } catch (err) {
        // The audit itself succeeded and has already been printed — report the
        // write failure without discarding what the user just paid for.
        return program.error(
          `Error: Could not write '${options.jsonOut}': ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  });

// Everything above only describes the command — parse() reads what was typed and acts on it
program.parse();
