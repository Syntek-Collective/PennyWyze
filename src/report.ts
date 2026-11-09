import Table from 'cli-table3';
import chalk from 'chalk';

import type { EarlyStopSavings, ModelSummary } from './summarize.js';
import type { Verdict } from './verdict.js';
import type { AgreementReport } from './calibration/agreement.js';

/** What graded this audit, and how far it has been shown to be trustworthy. */
export type GraderInfo = {
  kind: 'exact' | 'judge';
  /** The judge model's id. Judge audits only. */
  judgeModel?: string;
  /** Where the judge model came from: --judge-model, the env var, or the default. */
  judgeSource?: 'flag' | 'env' | 'default';
  /** Answers the judge decided (the rest were settled by exact match). */
  judgeDecisions?: number;
  /** Agreement with the user's hand labels, or null when none were given. */
  agreement: AgreementReport | null;
};

export type ReportExtras = {
  grader?: GraderInfo;
  /** USD of auditCost that went to judge calls. */
  graderCost?: number;
  earlyStop?: EarlyStopSavings;
};

const pct = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/**
 * One line, printed in every audit, saying what graded it and how much that
 * grader has been shown to agree with a person. A judge with no measured
 * agreement is called out loudly: its verdict is an unverified opinion.
 */
const printGraderTrust = (grader: GraderInfo): void => {
  const label =
    grader.kind === 'judge'
      ? `LLM judge (${grader.judgeModel}${grader.judgeSource === 'default' ? ', default' : ''})`
      : 'exact match';
  const decided =
    grader.kind === 'judge' && grader.judgeDecisions !== undefined
      ? chalk.dim(` — decided ${grader.judgeDecisions} answer${grader.judgeDecisions === 1 ? '' : 's'} exact match rejected`)
      : '';

  console.log(chalk.bold('  GRADER  ') + label + decided);

  const agreement = grader.agreement;
  if (!agreement || agreement.rate === null) {
    if (grader.kind === 'judge') {
      console.log(
        chalk.yellow.bold('  ⚠ Judge agreement: UNMEASURED.') +
          chalk.yellow(' Pass --calibration <labels.jsonl> before acting on this verdict.'),
      );
    } else {
      console.log(chalk.dim('  Agreement with your own grading: not measured (--calibration).'));
    }
    console.log();
    return;
  }

  const color =
    agreement.rate >= 0.9 ? chalk.green : agreement.rate >= 0.75 ? chalk.yellow : chalk.red;
  const breakdown = [
    `${agreement.falsePasses} false pass${agreement.falsePasses === 1 ? '' : 'es'}`,
    `${agreement.falseFails} false fail${agreement.falseFails === 1 ? '' : 's'}`,
    ...(agreement.unscored > 0 ? [`${agreement.unscored} undecided`] : []),
  ].join(' · ');

  console.log(
    color.bold(`  Agreement with your labels: ${agreement.agreed}/${agreement.scored} (${pct(agreement.rate)})`) +
      chalk.dim(`  ${breakdown}`),
  );

  // False passes first: those are the ones that would let a bad model win.
  const shown = [...agreement.disagreements]
    .sort((a, b) => (a.grader === 'pass' ? -1 : 0) - (b.grader === 'pass' ? -1 : 0))
    .slice(0, 3);
  for (const d of shown) {
    const answer = d.answer.length > 50 ? `${d.answer.slice(0, 47)}...` : d.answer;
    console.log(
      chalk.dim(`   · you: ${d.human}, grader: ${d.grader} — `) +
        JSON.stringify(answer) +
        (d.rationale ? chalk.dim(` (${d.rationale})`) : ''),
    );
  }
  console.log();
};

// Formatting lives here, not in summarize() — the summary carries counts,
// this turns them into the "48/50 (stopped)" the table shows.
const formatScore = (model: ModelSummary): string => {
  const score = `${model.passes}/${model.total}`;
  if (model.incomplete > 0) return `${score} ${chalk.dim('(incomplete)')}`;
  if (model.stopped) return `${score} ${chalk.dim('(stopped)')}`;
  return score;
};

export const printReport = (
  models: ModelSummary[],
  auditCost: number,
  datasetSize: number,
  /**
   * The decision, made upstream by decideVerdict. Passed in rather than
   * computed here so the printed verdict and the saved run record are
   * literally the same object.
   */
  verdict: Verdict,
  extras: ReportExtras = {},
) => {
  console.log('\n' + chalk.bold.cyan('  PENNYWYZE AUDIT REPORT'))

  const table = new Table({
    head: ['MODEL', 'ACCURACY', 'EST. COST / MO'],
    colAligns: ['left', 'center', 'right'],
    style: { 
      head: ['bold', 'white'] ,
      border: ['dim']
    },
  });

  for (const model of models) {
    const statusTag = model.passed
      ? chalk.green.bold('PASS')
      : model.incomplete > 0
        ? chalk.yellow.bold('N/A')
        : chalk.red.bold('FAIL')

      table.push([
        chalk.white(model.name),
        `${formatScore(model)} ${statusTag}`,
        `$${model.monthlyCost.toFixed(2)} / mo`
      ])
  }

  console.log(table.toString() + '\n');

  // Called out explicitly: an N/A row is missing data, not a quality failure,
  // and it is excluded from the verdict rather than counted as a loss.
  const incompleteModels = models.filter(m => m.incomplete > 0);
  if (incompleteModels.length > 0) {
    for (const model of incompleteModels) {
      console.log(
        chalk.yellow(`  ! ${model.name}: `) +
          `${model.incomplete} call${model.incomplete === 1 ? '' : 's'} did not complete — not eligible for the verdict.`,
      );
    }
    console.log();
  }

  const failedModels = models.filter(m => m.misses.length > 0)

  if (failedModels.length > 0) {
    console.log(chalk.bold.red('  FAILED TEST DETAILS'))
    console.log(chalk.dim('-'.repeat(55)))

    for (const model of failedModels) {
      console.log(`\n ${chalk.yellow('●')} ${chalk.bold(model.name)}`)

      model.misses.forEach((miss, index) => {
        const isLast = index === model.misses.length - 1
        const branch = isLast ? '└─' : '├─' // connector shown before this line
        const pipe = isLast ? '  ' : '│ ' // vertical continuation for the lines below
        const MAX_LENGTH = 60; // Set your preferred character cap

        // Only truncate if strictly longer than MAX_LENGTH, so a line at
        // exactly the cap isn't needlessly cut.
        const cleanInput = miss.input.length > MAX_LENGTH
          ? `${miss.input.slice(0, MAX_LENGTH - 3)}...`
          : miss.input

        console.log(chalk.dim(`   ${branch} Input:    `) + `"${cleanInput}"`)
        console.log(chalk.dim(`   ${pipe} Received: `) + chalk.red(JSON.stringify(miss.answer)))
        console.log(chalk.dim(`   ${pipe} Expected: `) + chalk.green(`"${miss.expected}"`))
        if (miss.rationale) {
          console.log(chalk.dim(`   ${pipe} Judge:    ${miss.rationale}`))
        }

        // Blank line between misses for readability, skipped after the last one
        if (!isLast) console.log(chalk.dim(`   │`))
      })
    console.log('\n' + chalk.dim('-'.repeat(55)) + '\n')
    }
  }

  // Before the verdict, so nobody reads the recommendation without first
  // seeing how far the grader behind it can be trusted.
  if (extras.grader) printGraderTrust(extras.grader)

  // Two different findings, told apart by reason rather than both printed as
  // "you're on the optimal tier" — which is false when nothing passed at all.
  if (verdict.reason === 'nothing_passed') {
    console.log(
      chalk.bgRed.black.bold(' VERDICT ') +
      ' ' +
      chalk.bold('No model met your pass bar.')
    )
    console.log(
      chalk.dim(
        '  Review the misses above, or lower --pass-rate if the bar is stricter than you need.',
      ),
    )
  } else if (verdict.recommended === null) {
    console.log(
      chalk.bgRed.black.bold(' VERDICT ') +
      ' ' +
      chalk.bold('No cheaper model meets quality criteria.')
    )
    console.log(chalk.dim('  You are currently on the optimal pricing tier.'))
  } else {
    const against = verdict.baselineIsAssumed ? '' : ` vs ${verdict.baseline}`
    console.log(
      chalk.bgGreen.black.bold(' VERDICT ') +
      ` Switch to ${chalk.bold.cyan(verdict.recommended)} - save ~$${verdict.savingsPerMonth.toFixed(2)}/mo (${Math.round(verdict.savingsPercent)}%)${against}.`
    )

    // The strongest form of the finding: same quality, lower bill.
    const winner = models.find(m => m.name === verdict.recommended)
    const baseline = models.find(m => m.name === verdict.baseline)
    if (
      winner && baseline && baseline.passed &&
      !winner.stopped && !baseline.stopped &&
      winner.passes === baseline.passes
    ) {
      console.log(
        chalk.dim(
          `  Scores identically to ${baseline.name} (${winner.passes}/${winner.total}) at ${Math.round(verdict.savingsPercent)}% lower cost.`,
        ),
      )
    }
    if (verdict.baselineIsAssumed) {
      console.log(
        chalk.dim(
          '  Measured against the most expensive tier audited. Pass --current <model> for savings against what you pay today.',
        ),
      )
    }
  }

  console.log()
  if (datasetSize < 30) {
    console.log(chalk.yellow(`  ⚠ Small dataset: only ${datasetSize} examples tested (30+ recommended for statistical confidence).`))
  }
  const judgeShare =
    extras.graderCost && extras.graderCost > 0
      ? chalk.dim(` (judge: $${extras.graderCost.toFixed(2)})`)
      : ''
  console.log(chalk.bold(`  ℹ Audit cost: $${auditCost.toFixed(2)}`) + judgeShare)

  const early = extras.earlyStop
  if (early && early.callsSkipped > 0) {
    console.log(
      chalk.dim(
        `  ℹ Early stopping skipped ${early.callsSkipped} of ${early.callsPossible} calls — saved ~$${early.savedUsd.toFixed(2)} (${pct(early.savedFraction)} of a full run).`,
      ),
    )
  }
  console.log()
};
