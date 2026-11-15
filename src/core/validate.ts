/**
 * Validation for generated diagram HTML files.
 *
 * This is the TypeScript counterpart of the skill's `scripts/self_check.py`
 * for the parts that keep a file safe and accessible in DSH: document
 * completeness, single-file safety (no scripts, no remote resources except the
 * approved Google Fonts stylesheet), the accessible-SVG contract (aria-labelled
 * non-hidden `<svg>`, `<title>` first, non-empty title/desc, aria-labelledby)
 * and a viewBox. Deep painted-geometry checks stay with the skill's Python
 * helper; this module deliberately checks what a save/preview needs.
 */

/** One validation finding. */
export interface Issue {
  /** `error` blocks saving; `warning` is advisory. */
  level: 'error' | 'warning'
  /** Stable machine code for tests. */
  code: string
  /** Human-readable explanation with the offending tag or value. */
  message: string
}

/** Result of validating one diagram HTML document. */
export interface ValidationResult {
  /** True when no `error` issues were found. */
  ok: boolean
  /** Blocking findings. */
  errors: Issue[]
  /** Advisory findings. */
  warnings: Issue[]
  /** Number of `<svg>` roots found. */
  svgCount: number
  /** Document `<title>` when present. */
  title?: string
}

/** Size cap for a saved diagram document. */
export const MAX_DIAGRAM_BYTES = 2 * 1024 * 1024

/** Resource-bearing tags whose remote targets would break single-file safety. */
const RESOURCE_TAGS = new Set(['img', 'script', 'iframe', 'object', 'embed', 'link', 'source', 'video', 'audio', 'track', 'image', 'use'])

/** Approved external stylesheet hosts (the skill's font stack). */
const APPROVED_FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com'])

/** Extract `<tag ...>` opening tags at the top level of a fragment. */
function openTags(html: string): Array<{ name: string; attrs: string; start: number; end: number }> {
  const tags: Array<{ name: string; attrs: string; start: number; end: number }> = []
  const pattern = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^"'>])*)>/gu
  for (const match of html.matchAll(pattern)) {
    if (match.index === undefined) continue
    tags.push({ name: match[1]!.toLowerCase(), attrs: match[2] ?? '', start: match.index, end: match.index + match[0].length })
  }
  return tags
}

/** Read one attribute value case-insensitively. */
function attr(attrs: string, name: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'iu')
  const match = pattern.exec(attrs)
  if (match === null) return undefined
  return match[1] ?? match[2] ?? match[3] ?? ''
}

/** Whether a URL is an approved font stylesheet or a safe local/data reference. */
function safeResourceUrl(tag: string, value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return true
  if (trimmed.startsWith('data:')) return true
  if (!/^(?:https?:)?\/\//iu.test(trimmed)) return true
  let host: string
  try {
    host = new URL(trimmed, 'https://placeholder.invalid').hostname.toLowerCase()
  } catch {
    return false
  }
  if (tag === 'link' && APPROVED_FONT_HOSTS.has(host) && trimmed.includes('fonts.googleapis.com/css2')) return true
  if (tag === 'image' || tag === 'use') return false
  return false
}

/** Collect one `<svg>` block starting at `start`. */
function svgBlock(html: string, start: number): string {
  const close = html.indexOf('</svg>', start)
  return close < 0 ? html.slice(start) : html.slice(start, close + 6)
}

/** Validate every accessible SVG in the document. */
function validateSvgs(html: string, errors: Issue[], warnings: Issue[]): number {
  const starts = [...html.matchAll(/<svg\b/gu)].map(match => match.index).filter((index): index is number => index !== undefined)
  let accessible = 0
  for (const start of starts) {
    const block = svgBlock(html, start)
    const openEnd = block.indexOf('>')
    const openTag = block.slice(0, openEnd + 1)
    const attrs = openTag.slice(4, -1)
    if ((attr(attrs, 'aria-hidden') ?? '').toLowerCase() === 'true') continue
    accessible += 1
    if (attr(attrs, 'viewBox') === undefined) {
      errors.push({ level: 'error', code: 'svg.viewBox', message: 'each accessible <svg> needs a viewBox' })
    }
    // The first child element of the svg must be <title>.
    const firstChild = /<([a-zA-Z][a-zA-Z0-9:-]*)/u.exec(block.slice(openEnd + 1))
    if (firstChild === null || firstChild[1]!.toLowerCase() !== 'title') {
      errors.push({ level: 'error', code: 'svg.titleFirst', message: '<title> must be the first child of each accessible <svg>' })
    }
    const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/u.exec(block)
    const descMatch = /<desc\b[^>]*>([\s\S]*?)<\/desc>/u.exec(block)
    const title = titleMatch?.[1]?.trim() ?? ''
    const desc = descMatch?.[1]?.trim() ?? ''
    if (title === '') errors.push({ level: 'error', code: 'svg.title', message: 'each accessible <svg> needs a non-empty <title>' })
    if (desc === '') errors.push({ level: 'error', code: 'svg.desc', message: 'each accessible <svg> needs a non-empty <desc>' })
    const labelledBy = attr(attrs, 'aria-labelledby')
    if (labelledBy === undefined || labelledBy.trim() === '') {
      errors.push({ level: 'error', code: 'svg.labelledby', message: 'each accessible <svg> needs aria-labelledby pointing at its title and desc' })
    } else {
      const ids = new Set(labelledBy.trim().split(/\s+/u))
      for (const [element, markup] of [['title', titleMatch?.[0]], ['desc', descMatch?.[0]]] as const) {
        const id = markup === undefined ? undefined : attr(markup.slice(0, markup.indexOf('>') + 1).slice(4, -1), 'id')
        if (id === undefined || id === '') errors.push({ level: 'error', code: `svg.${element}.id`, message: `the <${element}> needs an id referenced by aria-labelledby` })
        else if (!ids.has(id)) errors.push({ level: 'error', code: 'svg.labelledby.id', message: `aria-labelledby does not reference the <${element}> id "${id}"` })
      }
    }
  }
  return accessible
}

/**
 * Validate one diagram HTML document.
 * @param html - the complete self-contained HTML document.
 * @returns blocking errors, warnings and stats.
 */
export function validateDiagramHtml(html: string): ValidationResult {
  const errors: Issue[] = []
  const warnings: Issue[] = []
  const bytes = Buffer.byteLength(html, 'utf8')
  if (bytes === 0) {
    return { ok: false, errors: [{ level: 'error', code: 'document.empty', message: 'the diagram document is empty' }], warnings, svgCount: 0 }
  }
  if (bytes > MAX_DIAGRAM_BYTES) {
    errors.push({ level: 'error', code: 'document.size', message: `document exceeds ${MAX_DIAGRAM_BYTES} bytes (${bytes})` })
  }
  const lowered = html.toLowerCase()
  if (!lowered.trimStart().startsWith('<!doctype html')) {
    errors.push({ level: 'error', code: 'document.doctype', message: 'document must start with <!DOCTYPE html>' })
  }
  if (!lowered.includes('</html>') || !lowered.includes('</body>')) {
    errors.push({ level: 'error', code: 'document.complete', message: 'document looks truncated: missing </body> or </html>' })
  }
  if (!lowered.includes('<html')) {
    errors.push({ level: 'error', code: 'document.html', message: 'document is missing the <html> root' })
  }
  const scriptCount = [...html.matchAll(/<script\b/giu)].length
  if (scriptCount > 0) {
    errors.push({ level: 'error', code: 'document.script', message: `static diagrams must not contain <script> (found ${scriptCount}); remove scripts before saving` })
  }
  for (const tag of ['iframe', 'object', 'embed', 'base']) {
    if (new RegExp(`<${tag}\\b`, 'iu').test(html)) errors.push({ level: 'error', code: `document.${tag}`, message: `<${tag}> is not allowed in a single-file diagram` })
  }
  if (/\son[a-z]+\s*=/iu.test(html)) errors.push({ level: 'error', code: 'document.handler', message: 'inline event-handler attributes are not allowed' })
  if (/javascript\s*:/iu.test(html)) errors.push({ level: 'error', code: 'document.javascript', message: 'javascript: URLs are not allowed' })
  if (/data:text\/html/iu.test(html)) errors.push({ level: 'error', code: 'document.datahtml', message: 'data:text/html resources are not allowed' })
  for (const tag of openTags(html)) {
    if (!RESOURCE_TAGS.has(tag.name)) continue
    for (const name of ['src', 'href', 'xlink:href', 'poster', 'data']) {
      const value = attr(tag.attrs, name)
      if (value === undefined) continue
      if (!safeResourceUrl(tag.name, value)) {
        errors.push({ level: 'error', code: 'resource.remote', message: `remote reference on <${tag.name}> ${name}="${value.slice(0, 80)}" is not allowed` })
      }
    }
  }
  const cssUrls = [...html.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/giu)].map(match => match[1] ?? '')
  for (const url of cssUrls) {
    if (!/^(?:https?:)?\/\//iu.test(url.trim())) continue
    let host = ''
    try { host = new URL(url.trim(), 'https://placeholder.invalid').hostname.toLowerCase() } catch { /* invalid URL */ }
    if (!APPROVED_FONT_HOSTS.has(host)) errors.push({ level: 'error', code: 'resource.css', message: `remote CSS resource is not allowed: ${url.slice(0, 80)}` })
  }
  const svgCount = validateSvgs(html, errors, warnings)
  if (svgCount === 0) errors.push({ level: 'error', code: 'svg.missing', message: 'no accessible <svg> found: the diagram has nothing to render' })
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/u.exec(html)?.[1]?.trim()
  if (title === undefined) warnings.push({ level: 'warning', code: 'document.title', message: 'document is missing a <title>' })
  if (attr('<html ' + (openTags(html).find(tag => tag.name === 'html')?.attrs ?? '') + '>', 'lang') === undefined) {
    warnings.push({ level: 'warning', code: 'document.lang', message: '<html> is missing a lang attribute' })
  }
  return { ok: errors.length === 0, errors, warnings, svgCount, ...(title === undefined ? {} : { title }) }
}

/** Render validation findings as short model-facing lines. */
export function renderValidation(result: ValidationResult): string {
  const lines: string[] = []
  for (const issue of result.errors) lines.push(`ERROR [${issue.code}] ${issue.message}`)
  for (const issue of result.warnings) lines.push(`WARN [${issue.code}] ${issue.message}`)
  return lines.join('\n')
}
