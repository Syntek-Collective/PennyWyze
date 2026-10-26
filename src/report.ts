import Table from 'cli-table3';
import chalk from 'chalk';

import type { ModelSummary } from './summarize.js';
import type { Verdict } from './verdict.js';

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

        // Blank line between misses for readability, skipped after the last one
        if (!isLast) console.log(chalk.dim(`   │`))
      })
    console.log('\n' + chalk.dim('-'.repeat(55)) + '\n')
    }
  }

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
      ` Switch to ${chalk.bold.cyan(verdict.recommended)} - save ~$${verdict.savingsPerMonth.toFixed(2)}/mo${against}.`
    )
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
  console.log(chalk.bold(`  ℹ Audit cost: $${auditCost.toFixed(2)}\n`))
};
