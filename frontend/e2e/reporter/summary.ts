// Collects every check of every run and writes results/results.json and results/summary.md.
import { mkdirSync, writeFileSync } from 'node:fs'
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult } from '@playwright/test/reporter'
import { CHECKS, type CheckResult } from '../support/checks.ts'
import { RESULTS_DIR } from '../support/env.ts'

type Run = {
  screen: string
  group: string
  engine: string
  device: string
  loadFailure: string | null
  results: CheckResult[]
}
type Skipped = { screen: string; project: string; reason: string }

class SummaryReporter implements Reporter {
  runs: Run[] = []
  skipped: Skipped[] = []
  crashed: { screen: string; project: string; error: string }[] = []
  started = Date.now()

  onBegin(_config: FullConfig, suite: Suite) {
    console.log(`Running ${suite.allTests().length} runs (screen x width x engine). . = clean, F = at least one fault, s = skipped`)
  }

  // Global-setup failures (such as the mock-mode guard) arrive here; without this they would be silent.
  onError(error: TestError) {
    console.error(error.message ?? String(error))
  }

  onTestEnd(test: TestCase, result: TestResult) {
    process.stdout.write(result.status === 'passed' ? '.' : result.status === 'skipped' ? 's' : 'F')
    const project = test.parent.project()?.name ?? ''
    const screen = test.annotations.find((a) => a.type === 'screen')?.description ?? test.title
    if (result.status === 'skipped') {
      this.skipped.push({ screen, project, reason: test.annotations.find((a) => a.type === 'unavailable')?.description ?? 'skipped' })
      return
    }
    const att = result.attachments.find((a) => a.name === 'checks')
    if (!att?.body) {
      this.crashed.push({ screen, project, error: (result.error?.message ?? 'no result').split('\n')[0].slice(0, 200) })
      return
    }
    this.runs.push(JSON.parse(att.body.toString()))
  }

  onEnd(_result: FullResult) {
    if (this.runs.length === 0 && this.crashed.length === 0) return // aborted before any run (for example the mock-mode guard)
    mkdirSync(RESULTS_DIR, { recursive: true })
    const seconds = Math.round((Date.now() - this.started) / 1000)
    const failedRuns = (r: Run, id?: string) =>
      r.results.filter((c) => c.applies && c.offenders.length && (!id || c.id === id)).length
    // counts per screen x check: runs failing / runs measured
    const screens = [...new Set(this.runs.map((r) => r.screen))]
    const lines: string[] = []
    lines.push(`# Browser check summary`, '')
    lines.push(`${this.runs.length} runs (screen x width x engine) measured in ${seconds} s; ${this.skipped.length} skipped; ${this.crashed.length} crashed.`, '')
    lines.push('Each cell is the number of runs (device width x engine) in which the check found a fault, out of the runs measured.', '')
    lines.push(`| Screen | Runs | ${CHECKS.map((c) => c.id).join(' | ')} | Not ready |`)
    lines.push(`| --- | ---: | ${CHECKS.map(() => '---:').join(' | ')} | ---: |`)
    const totals: Record<string, [number, number]> = {}
    for (const s of screens) {
      const runs = this.runs.filter((r) => r.screen === s)
      const cells = CHECKS.map((c) => {
        const applicable = runs.filter((r) => r.results.find((x) => x.id === c.id)?.applies)
        const bad = applicable.filter((r) => failedRuns(r, c.id)).length
        const t = (totals[c.id] ??= [0, 0])
        t[0] += bad
        t[1] += applicable.length
        return `${bad}/${applicable.length}`
      })
      lines.push(`| ${s} | ${runs.length} | ${cells.join(' | ')} | ${runs.filter((r) => r.loadFailure).length} |`)
    }
    lines.push(`| **All** | ${this.runs.length} | ${CHECKS.map((c) => `**${totals[c.id]?.[0] ?? 0}/${totals[c.id]?.[1] ?? 0}**`).join(' | ')} | ${this.runs.filter((r) => r.loadFailure).length} |`, '')

    // per device
    const devices = [...new Set(this.runs.map((r) => r.device))]
    lines.push('## Faulty runs per width', '', `| Width | ${['chromium', 'webkit'].map((e) => `${e} (faulty/total)`).join(' | ')} |`, '| --- | ---: | ---: |')
    for (const d of devices) {
      const cell = (e: string) => {
        const rs = this.runs.filter((r) => r.device === d && r.engine === e)
        return `${rs.filter((r) => failedRuns(r)).length}/${rs.length}`
      }
      lines.push(`| ${d} | ${cell('chromium')} | ${cell('webkit')} |`)
    }
    lines.push('')

    // top offenders: same check + selector, counted across runs
    const counted = new Set<string>()
    const agg = new Map<string, { check: string; selector: string; text: string; size: string; detail?: string; runs: number; screens: Set<string> }>()
    for (const r of this.runs)
      for (const c of r.results)
        for (const o of c.offenders) {
          const key = `${c.id}|${o.selector}`
          const a = agg.get(key) ?? { check: c.id, selector: o.selector, text: o.text, size: o.size, detail: o.detail, runs: 0, screens: new Set() }
          if (!counted.has(`${key}|${r.screen}|${r.engine}|${r.device}`)) {
            counted.add(`${key}|${r.screen}|${r.engine}|${r.device}`)
            a.runs++ // one per run, however many rows of a list share the selector
          }
          a.screens.add(r.screen)
          agg.set(key, a)
        }
    const top = [...agg.values()].sort((a, b) => b.runs - a.runs)
    lines.push('## Top offenders', '', 'The same element in the same check, counted over all runs. Sample text and size are from one run.', '')
    lines.push('| Check | Element | Sample text | Sample size | Runs | Screens |', '| --- | --- | --- | --- | ---: | --- |')
    for (const a of top.slice(0, 25)) {
      lines.push(`| ${a.check} | \`${a.selector}\` | ${a.text.replace(/\|/g, '/') || '-'} | ${a.detail ?? a.size} | ${a.runs} | ${[...a.screens].slice(0, 4).join(', ')}${a.screens.size > 4 ? ` +${a.screens.size - 4}` : ''} |`)
    }
    lines.push('')
    if (this.skipped.length) {
      const reasons = new Map<string, number>()
      for (const s of this.skipped) reasons.set(`${s.screen}: ${s.reason}`, (reasons.get(`${s.screen}: ${s.reason}`) ?? 0) + 1)
      lines.push('## Skipped', '', ...[...reasons].map(([k, n]) => `- ${k} (${n} runs)`), '')
    }
    const loadFails = new Map<string, number>()
    for (const r of this.runs) if (r.loadFailure) loadFails.set(`${r.screen}: ${r.loadFailure}`, (loadFails.get(`${r.screen}: ${r.loadFailure}`) ?? 0) + 1)
    if (loadFails.size) lines.push('## Screens that did not reach their ready state', '', ...[...loadFails].map(([k, n]) => `- ${k} (${n} runs)`), '')
    if (this.crashed.length) lines.push('## Crashed runs', '', ...this.crashed.slice(0, 20).map((c) => `- ${c.screen} [${c.project}]: ${c.error}`), '')

    const md = lines.join('\n')
    writeFileSync(`${RESULTS_DIR}/summary.md`, md)
    writeFileSync(`${RESULTS_DIR}/results.json`, JSON.stringify({ seconds, runs: this.runs, skipped: this.skipped, crashed: this.crashed }, null, 1))
    console.log(`\n${md}\nSaved: ${RESULTS_DIR}/summary.md, results.json and screenshots/<screen>/<engine>/<width>.png`)
  }
}

export default SummaryReporter
