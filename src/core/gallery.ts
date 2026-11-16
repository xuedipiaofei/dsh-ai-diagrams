/**
 * Diagram-type index for the gallery panel and the `diagram_types` tool.
 *
 * The skill ships one `references/type-<slug>.md` per diagram type (title +
 * "Best for" line) and one or more `assets/example-<slug>*.html` pages. Both
 * are read from the vendored skill directory so the gallery always matches the
 * skill the model actually loads.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** One diagram type as shown in the gallery / tool listing. */
export interface DiagramType {
  /** Stable slug (the `type-<slug>.md` file name). */
  slug: string
  /** Human title from the reference's H1. */
  title: string
  /** Upstream "Best for" sentence. */
  bestFor: string
  /** Asset file name of an example page, when the skill ships one. */
  example?: string
}

/** Cap the example scan so a huge assets directory stays cheap. */
const MAX_TYPES = 200

/** Parse the title and "Best for" line from one type reference. */
function parseReference(slug: string, markdown: string): DiagramType {
  const titleMatch = /^#\s+(.+)$/mu.exec(markdown)
  const title = (titleMatch?.[1] ?? slug).trim()
  const bestMatch = /^\*\*Best for:\*\*\s*(.+)$/mu.exec(markdown)
  const bestFor = (bestMatch?.[1] ?? '').replace(/\s+/gu, ' ').trim()
  return { slug, title, bestFor }
}

/** Prefer the light single-page example, then the full/dark variants. */
function findExample(skillDir: string, slug: string): string | undefined {
  const assets = join(skillDir, 'assets')
  for (const candidate of [
    `example-${slug}.html`,
    `example-${slug}-full.html`,
    `example-${slug}-dark.html`,
  ]) {
    if (existsSync(join(assets, candidate))) return candidate
  }
  return undefined
}

/**
 * Build the type index from the vendored skill.
 * @param skillDir - skill root (contains references/ and assets/).
 * @returns types sorted by title; empty when the skill directory is missing.
 */
export function buildTypeIndex(skillDir: string): DiagramType[] {
  const references = join(skillDir, 'references')
  if (!existsSync(references)) return []
  const files = readdirSync(references)
    .filter(file => /^type-[a-z0-9-]+\.md$/iu.test(file))
    .sort()
    .slice(0, MAX_TYPES)
  const types: DiagramType[] = []
  for (const file of files) {
    const slug = file.replace(/^type-/u, '').replace(/\.md$/u, '')
    let markdown: string
    try {
      markdown = readFileSync(join(references, file), 'utf8')
    } catch {
      continue
    }
    const type = parseReference(slug, markdown)
    const example = findExample(skillDir, slug)
    types.push(example === undefined ? type : { ...type, example })
  }
  return types.sort((a, b) => a.title.localeCompare(b.title, 'en'))
}
