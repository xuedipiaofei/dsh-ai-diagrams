/**
 * SVG export for generated diagram HTML.
 *
 * The skill ships a standalone export procedure; this module covers the part a
 * DSH tool needs: pick the accessible diagram `<svg>` out of the document, make
 * it self-contained (xmlns, optional Google Fonts @import) and return it as a
 * `.svg` file without executing anything from the document.
 */

/** Google Fonts stylesheet used by the skill's editorial skin. */
const GOOGLE_FONTS_IMPORT =
  "@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&display=swap');"

/** Result of exporting one diagram document to SVG. */
export interface SvgExport {
  /** Complete standalone SVG markup (with XML prolog). */
  svg: string
  /** Document or SVG title, when available. */
  title?: string
  /** Warnings worth relaying to the model. */
  warnings: string[]
}

/** Read one attribute value case-insensitively. */
function attr(attrs: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'iu').exec(attrs)
  return match === null ? undefined : match[1] ?? match[2] ?? match[3] ?? ''
}

/** Find the bounds of every top-level `<svg>` block. */
function svgRanges(html: string): Array<{ start: number; openEnd: number; end: number }> {
  const ranges: Array<{ start: number; openEnd: number; end: number }> = []
  const pattern = /<svg\b/gu
  for (const match of html.matchAll(pattern)) {
    if (match.index === undefined) continue
    const start = match.index
    const openEnd = html.indexOf('>', start)
    if (openEnd < 0) continue
    const close = html.indexOf('</svg>', openEnd)
    ranges.push({ start, openEnd, end: close < 0 ? html.length : close + 6 })
  }
  return ranges
}

/** Extract the standalone SVG that represents the diagram. */
export function extractDiagramSvg(html: string, options: { fonts?: 'google' | 'none' } = {}): SvgExport {
  const warnings: string[] = []
  const ranges = svgRanges(html)
  if (ranges.length === 0) throw new Error('no <svg> element found in the diagram HTML')
  // Prefer the first svg that is not aria-hidden, matching the validator.
  const chosen = ranges.find(range => {
    const openTag = html.slice(range.start, range.openEnd + 1)
    const attrs = openTag.slice(4, -1)
    return (attr(attrs, 'aria-hidden') ?? '').toLowerCase() !== 'true'
  }) ?? ranges[0]!
  if (ranges.length > 1) warnings.push(`${ranges.length} <svg> roots found; exported the first accessible one`)
  let openTag = html.slice(chosen.start, chosen.openEnd + 1)
  let inner = html.slice(chosen.openEnd + 1, chosen.end - 6)
  if (!/\sxmlns\s*=/iu.test(openTag)) openTag = openTag.replace(/^<svg\b/u, '<svg xmlns="http://www.w3.org/2000/svg"')
  if (/xlink:/iu.test(inner) && !/\sxmlns:xlink\s*=/iu.test(openTag)) {
    openTag = openTag.replace(/^<svg\b/u, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"')
  }
  if (options.fonts === 'google') {
    // Keep <title> the first child of the exported SVG (accessible contract):
    // the font stylesheet goes after the title/desc block, not before it.
    const fontStyle = `<style type="text/css"><![CDATA[${GOOGLE_FONTS_IMPORT}]]></style>`
    const descEnd = inner.indexOf('</desc>')
    const titleEnd = inner.indexOf('</title>')
    if (descEnd >= 0) inner = `${inner.slice(0, descEnd + 7)}${fontStyle}${inner.slice(descEnd + 7)}`
    else if (titleEnd >= 0) inner = `${inner.slice(0, titleEnd + 8)}${fontStyle}${inner.slice(titleEnd + 8)}`
    else inner = `${fontStyle}${inner}`
  }
  const documentTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/u.exec(html)?.[1]?.trim()
  const svgTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/u.exec(inner)?.[1]?.trim()
  const title = (svgTitle !== undefined && svgTitle !== '' ? svgTitle : documentTitle)
  return {
    svg: `<?xml version="1.0" encoding="UTF-8"?>\n${openTag}${inner}</svg>\n`,
    ...(title === undefined || title === '' ? {} : { title }),
    warnings,
  }
}

/** A safe `.svg` file name base for one diagram title. */
export function svgFileBase(title: string | undefined): string {
  const ascii = (title ?? 'diagram').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  return ascii === '' ? 'diagram' : ascii.slice(0, 60)
}
