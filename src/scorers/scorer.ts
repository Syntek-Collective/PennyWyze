/** What a grader is shown for one answer. */
export type ScoreInput = {
  /** The question the model was asked. Empty when a label file omits it. */
  input: string;
  /** What the model said. */
  answer: string;
  /** The answer the dataset says is right. */
  expected: string;
};

/** Tokens a grader itself spent, so the audit can price grading separately. */
export type GraderUsage = {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
};

/** One grading decision. */
export type ScoreResult = {
  pass: boolean;
  /** Which grader made the call: exact match, or the LLM judge. */
  gradedBy: 'exact' | 'judge';
  /** The judge's explanation. Absent for exact-match decisions. */
  rationale?: string;
  /** Present only when grading cost money (a judge call). */
  usage?: GraderUsage;
};

/**
 * Anything that can grade an answer. Async because the LLM judge makes an API
 * call. A grader that cannot reach a decision (a failed or refused judge call)
 * throws — the audit records that answer as incomplete, never as a miss.
 */
export interface Scorer {
  /** Short label for reports and run records, e.g. 'exact' or 'judge:claude-opus-5-5'. */
  readonly name: string;
  score(input: ScoreInput): Promise<ScoreResult>;
}
