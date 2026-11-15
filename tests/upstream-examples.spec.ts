import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateDiagramHtml } from '../src/core/validate.ts'

/**
 * Real-data contract test: every static example the skill ships must pass the
 * DSH validator. This is what keeps the bundled validator honest against the
 * upstream skill as it is vendored (animated / motion examples are excluded:
 * DSH's static preview intentionally rejects scripts).
 */
const ASSETS = join(import.meta.dirname, '..', 'skills', 'diagram-design', 'assets')

const staticExamples = readdirSync(ASSETS)
  .filter(name => name.startsWith('example-') && name.endsWith('.html'))
  .filter(name => !name.includes('animated') && !name.includes('motion'))
  .sort()

describe('vendored skill examples', () => {
  it('finds the static examples', () => {
    expect(staticExamples.length).toBeGreaterThan(30)
  })

  it.each(staticExamples)('%s passes the DSH diagram contract', (name) => {
    const html = readFileSync(join(ASSETS, name), 'utf8')
    const result = validateDiagramHtml(html)
    if (!result.ok) {
      throw new Error(`${name} rejected:\n${result.errors.map(issue => `[${issue.code}] ${issue.message}`).join('\n')}`)
    }
  })
})
