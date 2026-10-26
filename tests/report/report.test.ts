import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { printReport } from '../../src/report.js'
import type { ModelSummary } from '../../src/summarize.js'
import { decideVerdict } from '../../src/verdict.js'

const baseModel = (overrides: Partial<ModelSummary> = {}): ModelSummary => ({
  name: 'model',
  passes: 50,
  total: 50,
  stopped: false,
  incomplete: 0,
  monthlyCost: 100,
  passed: true,
  misses: [],
  ...overrides,
})

describe('printReport', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  const printedOutput = () => logSpy.mock.calls.map((call: unknown[]) => call.join(' ')).join('\n')

  it('recommends the cheapest model that passed, never a cheaper one that failed', () => {
    // Three models on purpose: the winner has to be genuinely cheaper than
    // something else that passed, or this also exercises the zero-savings
    // path and stops testing what it claims to test.
    const models = [
      baseModel({ name: 'cheap-but-failed', monthlyCost: 10, passed: false }),
      baseModel({ name: 'mid-and-passed', monthlyCost: 50, passed: true }),
      baseModel({ name: 'expensive-and-passed', monthlyCost: 200, passed: true }),
    ]

    printReport(models, 0.15, 50, decideVerdict(models))

    const output = printedOutput()
    expect(output).toContain('Switch to mid-and-passed')
    expect(output).not.toContain('Switch to cheap-but-failed')
    expect(output).toContain('save ~$150.00/mo')
  })

  it('does not suggest switching when the only passing model is the priciest', () => {
    // Savings would be $0.00 — recommending a switch here tells the user to
    // move to the tier they are already paying for.
    const models = [
      baseModel({ name: 'cheap-but-failed', monthlyCost: 10, passed: false }),
      baseModel({ name: 'pricey-but-passed', monthlyCost: 50, passed: true }),
    ]

    printReport(models, 0.15, 50, decideVerdict(models))

    const output = printedOutput()
    expect(output).toContain('You are currently on the optimal pricing tier')
    expect(output).not.toContain('Switch to')
  })

  it('says nothing met the bar when nothing passed', () => {
    // Not "you are on the optimal tier" — nothing worked, so there is no
    // claim to make about which tier is optimal.
    const models = [
      baseModel({ name: 'opus', monthlyCost: 200, passed: false }),
      baseModel({ name: 'sonnet', monthlyCost: 80, passed: false }),
    ]

    printReport(models, 0.15, 50, decideVerdict(models))

    const output = printedOutput()
    expect(output).toContain('No model met your pass bar.')
    expect(output).not.toContain('optimal pricing tier')
    expect(output).not.toContain('Switch to')
  })

  it('says you are already on the optimal tier when something passed but nothing is cheaper', () => {
    const models = [
      baseModel({ name: 'cheap-but-failed', monthlyCost: 10, passed: false }),
      baseModel({ name: 'pricey-but-passed', monthlyCost: 200, passed: true }),
    ]

    printReport(models, 0.15, 50, decideVerdict(models))

    const output = printedOutput()
    expect(output).toContain('No cheaper model meets quality criteria.')
    expect(output).toContain('optimal pricing tier')
    expect(output).not.toContain('Switch to')
  })

  it('measures savings against --current, not the priciest model audited', () => {
    const models = [
      baseModel({ name: 'expensive', monthlyCost: 900, passed: true }),
      baseModel({ name: 'what-we-run-today', monthlyCost: 300, passed: true }),
      baseModel({ name: 'cheapest', monthlyCost: 100, passed: true }),
    ]

    printReport(models, 0.15, 50, decideVerdict(models, 'what-we-run-today'))

    const output = printedOutput()
    // 300 - 100, not 900 - 100: the user never paid the 900.
    expect(output).toContain('save ~$200.00/mo vs what-we-run-today')
  })

  it('says nothing beats what the user already runs, when that is true', () => {
    const models = [
      baseModel({ name: 'what-we-run-today', monthlyCost: 100, passed: true }),
      baseModel({ name: 'pricier', monthlyCost: 900, passed: true }),
    ]

    printReport(models, 0.15, 50, decideVerdict(models, 'what-we-run-today'))

    const output = printedOutput()
    expect(output).toContain('You are currently on the optimal pricing tier')
    expect(output).not.toContain('Switch to')
  })

  it('flags an incomplete model as ineligible rather than failed', () => {
    const models = [
      baseModel({ name: 'had-errors', monthlyCost: 10, passed: false, incomplete: 3 }),
      baseModel({ name: 'clean-run', monthlyCost: 500, passed: true }),
    ]

    printReport(models, 0.15, 50, decideVerdict(models))

    const output = printedOutput()
    expect(output).toContain('3 calls did not complete')
    expect(output).not.toContain('Switch to had-errors')
  })

  it('warns when the dataset is under 30 examples', () => {
    printReport([baseModel()], 0.15, 20, decideVerdict([baseModel()]))

    expect(printedOutput()).toContain('Small dataset: only 20 examples tested')
  })

  it('does not warn when the dataset is 30 or more examples', () => {
    printReport([baseModel()], 0.15, 30, decideVerdict([baseModel()]))

    expect(printedOutput()).not.toContain('Small dataset')
  })
})