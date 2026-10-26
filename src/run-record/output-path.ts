import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

/**
 * Refuses an output path that would destroy one of the run's own inputs.
 *
 * The record is written with writeFileSync, which replaces whatever is there.
 * Pointing --json-out at the dataset overwrites the dataset — and the audit
 * has already finished by then, so the user loses the file and the run.
 *
 * Paths are resolved before comparing, so './data.jsonl' and an absolute path
 * to the same file are recognised as the same file.
 */
export const checkOutputPath = (
  jsonOut: string,
  inputs: { prompt: string; dataset: string },
): void => {
  const target = resolve(jsonOut);

  if (target === resolve(inputs.prompt)) {
    throw new Error(
      `--json-out would overwrite your prompt file ('${jsonOut}'). Choose a different path.`,
    );
  }

  if (target === resolve(inputs.dataset)) {
    throw new Error(
      `--json-out would overwrite your dataset file ('${jsonOut}'). Choose a different path.`,
    );
  }
};

/**
 * Creates the folder the record will be written to, before the audit runs.
 *
 * Deliberately early: an unwritable path or a typo'd folder is a mistake the
 * user can fix in a second, and finding out after a real audit means paying
 * for every call again. Throws on failure for the caller to report cleanly.
 */
export const prepareOutputPath = (jsonOut: string): void => {
  const dir = dirname(resolve(jsonOut));

  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    // Reported in the loaders' voice — name the path and what went wrong,
    // rather than surfacing a raw syscall error.
    throw new Error(
      `Cannot write to '${jsonOut}': the folder '${dir}' could not be created (${
        err instanceof Error ? err.message : String(err)
      }).`,
    );
  }
};
