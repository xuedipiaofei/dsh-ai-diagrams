import { describe, expect, it } from 'vitest'
import { validateDiagramHtml } from '../src/core/validate.ts'

/** Minimal valid static diagram document. */
const VALID = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Login flow</title>
  <link href="https://fonts.googleapis.com/css2?family=Geist&display=swap" rel="stylesheet">
</head>
<body>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" role="img" aria-labelledby="t1 d1">
    <title id="t1">Login flow</title>
    <desc id="d1">A user signs in and reaches the home page.</desc>
    <rect x="20" y="20" width="120" height="48" rx="4" fill="#ffffff" stroke="#2d3142"/>
    <text x="80" y="48" text-anchor="middle">Login</text>
  </svg>
</body>
</html>
`

/** Build a document whose svg body is replaced. */
function withSvg(body: string): string {
  return `<!DOCTYPE html><html lang="en"><head><title>x</title></head><body>${body}</body></html>`
}

describe('validateDiagramHtml', () => {
  it('accepts a complete static diagram with an accessible svg', () => {
    const result = validateDiagramHtml(VALID)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.svgCount).toBe(1)
    expect(result.title).toBe('Login flow')
  })

  it('requires the html doctype', () => {
    const result = validateDiagramHtml(VALID.replace('<!DOCTYPE html>', ''))
    expect(result.ok).toBe(false)
    expect(result.errors.map(issue => issue.code)).toContain('document.doctype')
  })

  it('rejects scripts', () => {
    const result = validateDiagramHtml(VALID.replace('</body>', '<script>alert(1)</script></body>'))
    expect(result.ok).toBe(false)
    expect(result.errors.map(issue => issue.code)).toContain('document.script')
  })

  it('rejects remote images but allows the approved font stylesheet', () => {
    const remote = validateDiagramHtml(VALID.replace('</body>', '<img src="https://evil.example/x.png" alt=""></body>'))
    expect(remote.errors.map(issue => issue.code)).toContain('resource.remote')
    expect(validateDiagramHtml(VALID).ok).toBe(true)
  })

  it('rejects javascript: urls and inline handlers', () => {
    const js = validateDiagramHtml(VALID.replace('</body>', '<a href="javascript:alert(1)">x</a></body>'))
    expect(js.errors.map(issue => issue.code)).toContain('document.javascript')
    const handler = validateDiagramHtml(VALID.replace('<rect ', '<rect onclick="x()" '))
    expect(handler.errors.map(issue => issue.code)).toContain('document.handler')
  })

  it('requires the accessible svg contract', () => {
    const noTitleFirst = validateDiagramHtml(withSvg('<svg viewBox="0 0 10 10"><rect width="1" height="1"/><title id="t">x</title><desc id="d">y</desc></svg>'))
    expect(noTitleFirst.errors.map(issue => issue.code)).toContain('svg.titleFirst')
    const noViewBox = validateDiagramHtml(withSvg('<svg><title id="t">x</title><desc id="d">y</desc></svg>'))
    expect(noViewBox.errors.map(issue => issue.code)).toContain('svg.viewBox')
    const noLabelledBy = validateDiagramHtml(withSvg('<svg viewBox="0 0 10 10"><title id="t">x</title><desc id="d">y</desc></svg>'))
    expect(noLabelledBy.errors.map(issue => issue.code)).toContain('svg.labelledby')
  })

  it('flags truncated documents and missing svg', () => {
    const truncated = validateDiagramHtml('<!DOCTYPE html><html><body><svg viewBox="0 0 1 1"><title id="t">x</title><desc id="d">y</desc><rect width="1" height="1"/></svg>')
    expect(truncated.errors.map(issue => issue.code)).toContain('document.complete')
    const empty = validateDiagramHtml('<!DOCTYPE html><html lang="en"><head><title>x</title></head><body><p>no diagram</p></body></html>')
    expect(empty.errors.map(issue => issue.code)).toContain('svg.missing')
  })
})
