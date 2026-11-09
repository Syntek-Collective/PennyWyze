import type { GraderUsage, Scorer } from '../scorers/scorer.js';
import { JudgeError } from '../scorers/judge/llm-judge-scorer.js';
import type { LabeledExample } from './schema.js';

export type Disagreement = {
  input: string;
  answer: string;
  expected: string;
  human: 'pass' | 'fail';
  grader: 'pass' | 'fail';
  rationale: string | null;
};

/** How often the grader agreed with a person, on the person's own labels. */
export type AgreementReport = {
  grader: string;
  /** Labels the grader reached a decision on. */
  scored: number;
  agreed: number;
  /** agreed / scored, 0–1. Null when nothing could be scored. */
  rate: number | null;
  /** Grader passed an answer a person failed — the costly kind of mistake. */
  falsePasses: number;
  /** Grader failed an answer a person passed. */
  falseFails: number;
  /** Labels the grader could not decide (failed or refused judge calls). */
  unscored: number;
  disagreements: Disagreement[];
  /** Every paid grader call made while measuring, for the audit's cost. */
  usage: GraderUsage[];
};

/**
 * Runs the grader exactly as the audit will use it over hand-labeled answers,
 * and counts how often it agrees with the person who labeled them.
 *
 * Measured on the whole grader — exact match first, then the judge — because
 * that combination is what decides every verdict, not the judge alone.
 */
export const measureAgreement = async (
  scorer: Scorer,
  labels: LabeledExample[],
): Promise<AgreementReport> => {
  const report: AgreementReport = {
    grader: scorer.name,
    scored: 0,
    agreed: 0,
    rate: null,
    falsePasses: 0,
    falseFails: 0,
    unscored: 0,
    disagreements: [],
    usage: [],
  };

  for (const example of labels) {
    const item = {
      input: example.input ?? '',
      answer: example.answer,
      expected: example.expected,
    };

    let result;
    try {
      result = await scorer.score(item);
    } catch (err) {
      // An undecided label is left out of the rate rather than counted as a
      // disagreement — but it is reported, and its tokens still cost money.
      if (err instanceof JudgeError) report.usage.push(err.usage);
      report.unscored++;
      continue;
    }

    if (result.usage) report.usage.push(result.usage);
    report.scored++;

    const grader = result.pass ? 'pass' : 'fail';
    if (grader === example.label) {
      report.agreed++;
      continue;
    }

    if (grader === 'pass') report.falsePasses++;
    else report.falseFails++;

    report.disagreements.push({
      ...item,
      human: example.label,
      grader,
      rationale: result.rationale ?? null,
    });
  }

  report.rate = report.scored > 0 ? report.agreed / report.scored : null;
  return report;
};
