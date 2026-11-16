import { describe, expect, it } from 'vitest'
import {
  extractBrandProfile,
  profilePath,
  renderProfile,
  safeProfileName,
  type BrandProfile,
} from '../src/core/profile.ts'

/** Small page with a `<style>` block and an inline style attribute. */
const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>
    Acme   Design
    System
  </title>
  <style>
    :root { --ink: #0F172A; --paper: #ffffff; --line: #fefefe; }
    body { color: #0f172a; background-color: #FAFAFA; font-family: 'Inter', sans-serif; }
    h1 { color: #0f172a; font-family: "Instrument Serif", Georgia, serif; }
    code { color: #ABC; font-family: Geist Mono, monospace; }
    .accent { color: #F97066; }
    .ghost { background: #ffffff80; font-family: system-ui, sans-serif; }
  </style>
</head>
<body style="color:#0F172A; background:#ffffff; font-family: Inter, sans-serif">
  <h1>Acme</h1>
</body>
</html>`

/** Profile fixture for render tests. */
const PROFILE: BrandProfile = {
  title: 'Acme Design System',
  sourceUrl: 'https://acme.example/design-system',
  fetchedAt: '2026-01-02T03:04:05.000Z',
  palette: [
    { hex: '#0f172a', count: 42 },
    { hex: '#f97066', count: 3 },
  ],
  fonts: ['Inter', 'Instrument Serif'],
}

describe('extractBrandProfile', () => {
  it('reads title, palette and fonts from CSS blocks and inline styles', () => {
    const profile = extractBrandProfile(PAGE, 'https://acme.example/design-system')
    expect(profile.title).toBe('Acme Design System')
    expect(profile.sourceUrl).toBe('https://acme.example/design-system')
    expect(profile.palette).toEqual([
      { hex: '#0f172a', count: 4 },
      { hex: '#aabbcc', count: 1 },
      { hex: '#f97066', count: 1 },
    ])
    expect(profile.fonts).toEqual(['Inter', 'Instrument Serif', 'Geist Mono'])
  })

  it('stamps a canonical ISO fetchedAt', () => {
    const profile = extractBrandProfile(PAGE, 'https://acme.example/')
    expect(profile.fetchedAt).toBe(new Date(profile.fetchedAt).toISOString())
  })

  it('expands 3-digit hex and lowercases literals', () => {
    const profile = extractBrandProfile(
      '<style>.a{color:#ABC}.b{border-color:#0A0}.c{background:#FFF}</style>',
      'https://example.com/',
    )
    expect(profile.palette).toEqual([
      { hex: '#00aa00', count: 1 },
      { hex: '#aabbcc', count: 1 },
    ])
  })

  it('drops near-white colours but keeps black and ignores alpha hex', () => {
    const profile = extractBrandProfile(
      `<style>
        .a { color: #FFFFFF; background: #FEFEFE; border-color: #FAFAFA; }
        .b { color: #F0F0F0; }
        .c { color: #000; background: #0A0A0A; }
        .d { color: #12345678; }
      </style>`,
      'https://example.com/',
    )
    expect(profile.palette).toEqual([
      { hex: '#000000', count: 1 },
      { hex: '#0a0a0a', count: 1 },
    ])
  })

  it('ranks colours by count and keeps the top eight', () => {
    const unique = [
      '#111111',
      '#222222',
      '#333333',
      '#444444',
      '#555555',
      '#666666',
      '#777777',
      '#888888',
      '#999999',
      '#aaaaaa',
    ]
    const rules = [...Array<string>(3).fill('#0f172a'), ...unique]
      .map((hex, index) => `.c${index}{color:${hex}}`)
      .join('')
    const palette = extractBrandProfile(`<style>${rules}</style>`, 'https://example.com/').palette
    expect(palette).toHaveLength(8)
    expect(palette[0]).toEqual({ hex: '#0f172a', count: 3 })
    expect(palette.slice(1).map(entry => entry.hex)).toEqual([
      '#111111',
      '#222222',
      '#333333',
      '#444444',
      '#555555',
      '#666666',
      '#777777',
    ])
  })

  it('dedupes fonts case-insensitively and skips generic declarations', () => {
    const profile = extractBrandProfile(
      `<style>
        a { font-family: Inter }
        b { font-family: 'INTER' }
        c { font-family: inter }
        d { font-family: "Inter var" }
        e { font-family: system-ui, sans-serif }
      </style>`,
      'https://example.com/',
    )
    expect(profile.fonts).toEqual(['Inter', 'Inter var'])
  })

  it('keeps the first four fonts in page order', () => {
    const profile = extractBrandProfile(
      `<style>
        a { font-family: One }
        b { font-family: Two }
        c { font-family: Three }
        d { font-family: Four }
        e { font-family: Five }
      </style>`,
      'https://example.com/',
    )
    expect(profile.fonts).toEqual(['One', 'Two', 'Three', 'Four'])
  })

  it('collapses title whitespace and decodes entities', () => {
    const profile = extractBrandProfile(
      '<title> Acme &amp; Co\n\t —   Docs </title>',
      'https://example.com/',
    )
    expect(profile.title).toBe('Acme & Co — Docs')
  })

  it('falls back to the hostname when the title is missing or blank', () => {
    expect(extractBrandProfile('<p>Hello</p>', 'https://Docs.Example.com:8443/a').title).toBe(
      'docs.example.com',
    )
    expect(extractBrandProfile('<title>   </title>', 'https://example.com/').title).toBe(
      'example.com',
    )
    expect(extractBrandProfile('', 'not a url').title).toBe('')
  })
})

describe('renderProfile', () => {
  it('renders the profile sections and token lines', () => {
    const markdown = renderProfile(PROFILE, 'acme')
    expect(markdown).toContain('# Brand profile: acme')
    expect(markdown).toContain('- source: https://acme.example/design-system')
    expect(markdown).toContain('- fetched: 2026-01-02T03:04:05.000Z')
    expect(markdown).toContain('- title: Acme Design System')
    expect(markdown).toContain('## Palette')
    expect(markdown).toContain('- #0f172a (42)')
    expect(markdown).toContain('- #f97066 (3)')
    expect(markdown).toContain('## Typefaces')
    expect(markdown).toContain('- Inter')
    expect(markdown).toContain('- Instrument Serif')
    expect(markdown).toContain('## Usage')
    expect(markdown).toContain('4px grid')
    expect(markdown).toContain('substitute only these tokens.')
    expect(markdown.indexOf('## Palette')).toBeLessThan(markdown.indexOf('## Typefaces'))
    expect(markdown.indexOf('## Typefaces')).toBeLessThan(markdown.indexOf('## Usage'))
  })

  it('keeps empty sections with a short Chinese note', () => {
    const markdown = renderProfile({ ...PROFILE, palette: [], fonts: [] }, 'blank')
    expect(markdown).toContain('## Palette')
    expect(markdown).toContain('未从页面提取到配色')
    expect(markdown).toContain('## Typefaces')
    expect(markdown).toContain('未从页面提取到字体')
    expect(markdown).not.toContain('- #')
  })
})

describe('safeProfileName', () => {
  it('slugs names and strips diacritics', () => {
    expect(safeProfileName('Café déjà vu')).toBe('cafe-deja-vu')
    expect(safeProfileName('  --Hello,   World!! -- ')).toBe('hello-world')
    expect(safeProfileName('Acme_Design.System')).toBe('acme-design-system')
  })

  it('neutralizes path traversal attempts', () => {
    expect(safeProfileName('../../etc/passwd')).toBe('etc-passwd')
    expect(safeProfileName('..\\..\\Windows\\system32')).toBe('windows-system32')
    expect(safeProfileName('../')).toBe('profile')
    expect(safeProfileName('/')).toBe('profile')
    expect(safeProfileName('...')).toBe('profile')
  })

  it('falls back when no ASCII alphanumerics remain and caps the length', () => {
    expect(safeProfileName('')).toBe('profile')
    expect(safeProfileName('你好')).toBe('profile')
    expect(safeProfileName('!!! ###')).toBe('profile')
    const long = safeProfileName('A'.repeat(200))
    expect(long).toHaveLength(64)
    expect(long).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/u)
  })

  it('always returns one path segment', () => {
    const raw = ['../../etc/passwd', 'a/b', 'a\\b', 'a..b', '${HOME}', 'a\u0000b']
    for (const name of raw.map(safeProfileName)) {
      expect(name).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/u)
      expect(name).not.toContain('/')
      expect(name).not.toContain('\\')
      expect(name).not.toContain('..')
    }
  })
})

describe('profilePath', () => {
  it('writes the slug under the base directory', () => {
    expect(profilePath('/tmp/brand', 'Acme Design System')).toBe('/tmp/brand/acme-design-system.md')
    expect(profilePath('/tmp/brand/', 'Acme')).toBe('/tmp/brand/acme.md')
    expect(profilePath('profiles', 'Acme')).toBe('profiles/acme.md')
    expect(profilePath('', 'Acme')).toBe('acme.md')
    expect(profilePath('/', 'Acme')).toBe('/acme.md')
  })

  it('keeps traversal attempts inside the base directory', () => {
    const path = profilePath('/tmp/brand', '../../etc/passwd')
    expect(path).toBe('/tmp/brand/etc-passwd.md')
    expect(path.startsWith('/tmp/brand/')).toBe(true)
    expect(path).not.toContain('..')
    expect(path).not.toContain('/etc/')
  })
})
