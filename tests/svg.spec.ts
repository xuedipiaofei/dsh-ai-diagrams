import { describe, expect, it } from 'vitest'
import { extractDiagramSvg, svgFileBase } from '../src/core/svg.ts'

const HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Login flow</title></head>
<body>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" role="img" aria-labelledby="t d">
    <title id="t">Login flow</title>
    <desc id="d">Sign in.</desc>
    <rect x="10" y="10" width="100" height="40"/>
  </svg>
</body>
</html>`

describe('extractDiagramSvg', () => {
  it('exports a standalone svg with an xml prolog and a title', () => {
    const exported = extractDiagramSvg(HTML)
    expect(exported.svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(exported.svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(exported.svg).toContain('viewBox="0 0 400 200"')
    expect(exported.svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(exported.title).toBe('Login flow')
  })

  it('embeds the font import only when requested', () => {
    const withFonts = extractDiagramSvg(HTML, { fonts: 'google' }).svg
    expect(withFonts).toContain('fonts.googleapis.com')
    expect(extractDiagramSvg(HTML, { fonts: 'none' }).svg).not.toContain('fonts.googleapis.com')
    // The accessible contract requires <title> first, so the font style follows it.
    expect(withFonts.indexOf('<title')).toBeLessThan(withFonts.indexOf('<style'))
  })

  it('adds a missing xmlns', () => {
    const exported = extractDiagramSvg(HTML.replace(' xmlns="http://www.w3.org/2000/svg"', ''))
    expect(exported.svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('throws when there is no svg', () => {
    expect(() => extractDiagramSvg('<!DOCTYPE html><html><body>nope</body></html>')).toThrow(/no <svg>/)
  })
})

describe('svgFileBase', () => {
  it('slugifies titles', () => {
    expect(svgFileBase('Login Flow!')).toBe('login-flow')
    expect(svgFileBase(undefined)).toBe('diagram')
    expect(svgFileBase('中文标题')).toBe('diagram')
  })
})
