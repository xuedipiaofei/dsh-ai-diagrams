/**
 * Browser-side contract for the ai-diagrams card.
 *
 * The card never receives the diagram HTML through the tool result (that would
 * replay the whole document into the conversation): the Host keeps a loopback
 * route for files `diagram_save` wrote and the card points an iframe at it.
 */

/** Tool name shared by the host tool and the client tool view. */
export const SAVE_TOOL = 'diagram_save'

/** Route family served by the host half. */
export const ROUTES = {
  raw: '/api/dsh-ai-diagrams/raw',
  svg: '/api/dsh-ai-diagrams/svg',
} as const

/** Tool-result presentation metadata for one saved diagram. */
export interface DiagramMeta {
  /** Diagram title. */
  title?: string
  /** Absolute path of the saved HTML file. */
  path?: string
  /** Saved byte count. */
  bytes?: number
}

/** Build a preview/raw URL for one saved diagram path. */
export function rawUrl(path: string): string {
  return `${ROUTES.raw}?path=${encodeURIComponent(path)}`
}

/** Build an SVG export URL; `fonts=none` keeps the SVG offline-friendly. */
export function svgUrl(path: string, fonts: 'google' | 'none'): string {
  return `${ROUTES.svg}?path=${encodeURIComponent(path)}&fonts=${fonts}`
}

/** Filesystem-safe file stem for a title. */
export function fileStem(title: string | undefined): string {
  const stem = (title ?? 'diagram').replace(/[^\w.-]+/gu, '-')
  return stem === '' ? 'diagram' : stem
}
