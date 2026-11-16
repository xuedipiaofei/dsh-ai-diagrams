/**
 * Brand profile helpers for redrawing a site's diagrams in its own palette and
 * type.
 *
 * Pure, dependency-free string work: extract a bounded palette and typeface
 * list from fetched HTML, render the profile as the Markdown document a later
 * `diagram_profile` host tool writes, and keep profile file names portable.
 * Nothing here fetches, reads or writes files.
 */

/** One palette colour and how often it occurred in the source. */
export interface PaletteColor {
  /** Normalized lowercase `#rrggbb`. */
  hex: string
  /** Number of occurrences in the HTML. */
  count: number
}

/** What a page's diagram skin should borrow. */
export interface BrandProfile {
  /** Page `<title>` with whitespace collapsed, or the source hostname. */
  title: string
  /** Page URL exactly as provided. */
  sourceUrl: string
  /** Extraction time, ISO 8601. */
  fetchedAt: string
  /** Dominant non-near-white colours, strongest first (max 8). */
  palette: PaletteColor[]
  /** First-choice typefaces in page order (max 4). */
  fonts: string[]
}

/** Palette entries kept. */
const MAX_PALETTE = 8
/** Typefaces kept. */
const MAX_FONTS = 4
/** Longest profile slug (`[a-z0-9][a-z0-9-]{0,63}`). */
const MAX_PROFILE_NAME = 64
/** Used when a name has no usable ASCII alphanumerics. */
const FALLBACK_PROFILE_NAME = 'profile'

/** Hex literals in CSS, inline styles and style blocks. */
const HEX_COLOR_RE = /(?<![\w&])#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/giu
/** A `font-family:` declaration up to the end of the declaration. */
const FONT_FAMILY_RE = /font-family\s*:\s*([^;}]+)/giu
/** First family in a comma list, quoted or unquoted. */
const FIRST_FAMILY_RE = /^\s*(?:"([^"]*)"|'([^']*)'|([^,]+))/u
/** Page title element. */
const TITLE_RE = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu

/** Families that are fallback keywords rather than usable typefaces. */
const GENERIC_FAMILIES = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'system-ui',
  'inherit',
  'cursive',
  'fantasy',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
])

/** Named HTML entities worth decoding in a title. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
}

/** Collapse every whitespace run (newlines, tabs included) to one space. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

/** Decode the basic entities a `<title>` can contain. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_whole, code: string) => codePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/gu, (_whole, code: string) => codePoint(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);/giu, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
}

/** A valid code point as a character; anything else disappears. */
function codePoint(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return ''
  if (value >= 0xd800 && value <= 0xdfff) return ''
  return String.fromCodePoint(value)
}

/** Hostname of `sourceUrl`, or `''` when it cannot be parsed. */
function hostnameOf(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname
  } catch {
    return ''
  }
}

/** Page title, falling back to the source hostname. */
function extractTitle(html: string, sourceUrl: string): string {
  const raw = TITLE_RE.exec(html)?.[1] ?? ''
  const title = collapseWhitespace(decodeEntities(raw.replace(/<[^>]*>/gu, '')))
  return title === '' ? hostnameOf(sourceUrl) : title
}

/** Expand `#rgb` and lowercase a scanned literal. */
function normalizeHex(digits: string): string {
  const lower = digits.toLowerCase()
  return lower.length === 3
    ? `#${[...lower].map(channel => `${channel}${channel}`).join('')}`
    : `#${lower}`
}

/** True when every channel is at or above `0xf0` (paper, not ink). */
function isNearWhite(hex: string): boolean {
  const channels = [1, 3, 5].map(start => Number.parseInt(hex.slice(start, start + 2), 16))
  return channels.every(channel => channel >= 0xf0)
}

/** Count non-near-white hex literals, strongest first, then by hex. */
function extractPalette(html: string): PaletteColor[] {
  const counts = new Map<string, number>()
  for (const match of html.matchAll(HEX_COLOR_RE)) {
    const hex = normalizeHex(match[1] ?? '')
    if (isNearWhite(hex)) continue
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([hex, count]) => ({ hex, count }))
    .sort(
      (left, right) =>
        right.count - left.count || (left.hex < right.hex ? -1 : left.hex > right.hex ? 1 : 0),
    )
    .slice(0, MAX_PALETTE)
}

/** First family of one `font-family` value, or `undefined` when unusable. */
function firstFamily(value: string): string | undefined {
  const declaration = value.replace(/!\s*important\s*$/iu, '').trim()
  const match = FIRST_FAMILY_RE.exec(declaration)
  if (match === null) return undefined
  const family = collapseWhitespace((match[1] ?? match[2] ?? match[3] ?? '').replace(/^["']|["']$/gu, ''))
  if (family === '') return undefined
  const lower = family.toLowerCase()
  if (GENERIC_FAMILIES.has(lower) || lower.startsWith('var(')) return undefined
  return family
}

/** First-choice typefaces in first-appearance order, case-insensitively unique. */
function extractFonts(html: string): string[] {
  const seen = new Set<string>()
  const fonts: string[] = []
  for (const match of html.matchAll(FONT_FAMILY_RE)) {
    const family = firstFamily(match[1] ?? '')
    if (family === undefined) continue
    const key = family.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    fonts.push(family)
    if (fonts.length === MAX_FONTS) break
  }
  return fonts
}

/**
 * Extract a bounded brand profile from a page's HTML.
 *
 * `fetchedAt` is the moment of extraction; callers that need a stable profile
 * should persist the returned document rather than re-extracting.
 */
export function extractBrandProfile(html: string, sourceUrl: string): BrandProfile {
  return {
    title: extractTitle(html, sourceUrl),
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    palette: extractPalette(html),
    fonts: extractFonts(html),
  }
}

/** The token-swap instruction that closes every profile document. */
const USAGE =
  'Use the palette for ink/paper/accent roles and the typefaces as heading/body; keep the editorial diagram system (4px grid, hairline strokes, coral accent) and substitute only these tokens.'

/** Shown when the page yielded no colours (wording follows the plugin's zh docs). */
const EMPTY_PALETTE = '（未从页面提取到配色。）'
/** Shown when the page yielded no typefaces. */
const EMPTY_FONTS = '（未从页面提取到字体。）'

/**
 * Render a profile as the Markdown document stored next to the diagrams.
 *
 * Sections stay even when a page is unhelpful, so the agent always gets the
 * usage rule and can see that extraction found nothing.
 */
export function renderProfile(profile: BrandProfile, name: string): string {
  const lines = [
    `# Brand profile: ${name}`,
    '',
    `- source: ${profile.sourceUrl}`,
    `- fetched: ${profile.fetchedAt}`,
    `- title: ${profile.title}`,
    '',
    '## Palette',
    ...(profile.palette.length === 0
      ? [EMPTY_PALETTE]
      : profile.palette.map(entry => `- ${entry.hex} (${entry.count})`)),
    '',
    '## Typefaces',
    ...(profile.fonts.length === 0 ? [EMPTY_FONTS] : profile.fonts.map(font => `- ${font}`)),
    '',
    '## Usage',
    USAGE,
  ]
  return `${lines.join('\n')}\n`
}

/**
 * Turn any label into a portable, single-segment file name:
 * `[a-z0-9][a-z0-9-]{0,63}`, never a path.
 */
export function safeProfileName(raw: string): string {
  const slug = raw
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, MAX_PROFILE_NAME)
    .replace(/-+$/gu, '')
  return slug === '' ? FALLBACK_PROFILE_NAME : slug
}

/**
 * Markdown path for a named profile: `<baseDir>/<safeProfileName(name)>.md`.
 *
 * Only the name is sanitized; `baseDir` is trusted host configuration and is
 * used as given except for trailing separators.
 */
export function profilePath(baseDir: string, name: string): string {
  const file = `${safeProfileName(name)}.md`
  const base = baseDir.replace(/[\\/]+$/u, '')
  if (base !== '') return `${base}/${file}`
  // A baseDir of just separators is a filesystem root; keep it absolute.
  return /^[\\/]+$/u.test(baseDir) ? `${baseDir.slice(0, 1)}${file}` : file
}
