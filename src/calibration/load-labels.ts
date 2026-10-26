import { existsSync, readFileSync } from 'fs';

import { labeledExampleSchema, type LabeledExample } from './schema.js';

/**
 * Reads a hand-labeled calibration file (JSONL). Same contract as the dataset
 * loader: any bad line stops the load and is named by number, so the agreement
 * rate is never computed over fewer labels than the user thinks they gave.
 */
export const loadLabels = (path: string): LabeledExample[] => {
  if (!existsSync(path)) {
    throw new Error(`Calibration file not found: '${path}'`);
  }

  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const labels: LabeledExample[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(
        `Line ${i + 1} of your calibration file is not valid JSON.`,
      );
    }

    const result = labeledExampleSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues
        .map(issue => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n');
      throw new Error(
        `Line ${i + 1} of your calibration file is invalid:\n${issues}`,
      );
    }
    labels.push(result.data);
  }

  if (labels.length === 0) {
    throw new Error(
      `Calibration file '${path}' is empty. Provide at least 1 labeled example.`,
    );
  }
  return labels;
};
