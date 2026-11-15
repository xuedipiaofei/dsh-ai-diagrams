/**
 * Card export actions.
 *
 * SVG and PNG come from the Host's loopback SVG route (the same extraction the
 * `diagram_svg` tool uses); PNG rasterization happens in the page through a
 * canvas, so DSH needs neither Python nor Playwright. The PNG request asks for
 * `fonts=none` because an SVG image with an external font import would not
 * rasterize reliably.
 */
import { useCallback, useRef, useState } from 'react'
import { fileStem, rawUrl, svgUrl } from './contract.ts'
import { tt } from './panel-helpers.ts'

/** Download one blob under a file name. */
function download(blob: Blob, fileName: string): void {
  const anchor = document.createElement('a')
  anchor.href = URL.createObjectURL(blob)
  anchor.download = fileName
  anchor.click()
  setTimeout(() => { URL.revokeObjectURL(anchor.href) }, 1000)
}

/** Fetch a same-origin route as text, surfacing the route's error body. */
async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'no-store' })
  const text = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 200)}`)
  return text
}

/** Strip executable content before handing some SVG to the canvas/download. */
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/giu, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/giu, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/giu, '')
    .replace(/javascript:/giu, '')
}

/** Read the intrinsic size of an SVG's viewBox for rasterization. */
function viewBoxSize(svg: string): { width: number; height: number } | undefined {
  const match = /viewBox\s*=\s*"([^"]+)"/iu.exec(svg)
  if (match === null) return undefined
  const parts = match[1]!.trim().split(/[\s,]+/u).map(Number)
  if (parts.length !== 4 || parts.some(value => !Number.isFinite(value)) || parts[2]! <= 0 || parts[3]! <= 0) return undefined
  return { width: parts[2]!, height: parts[3]! }
}

/**
 * Prepare standalone SVG markup for `<img>` decoding: strip the XML prolog and
 * pin the intrinsic width/height on the root without duplicating an existing
 * `xmlns` (a redefined xmlns makes Chrome refuse the SVG image).
 * @param svg - exported standalone SVG text.
 * @param size - viewBox size to use for rasterization.
 * @returns markup for a `data:image/svg+xml` URL.
 */
export function rasterMarkup(svg: string, size: { width: number; height: number }): string {
  const stripped = svg.replace(/<\?xml[^>]*\?>/iu, '')
  return stripped.replace(/<svg\b([^>]*)>/iu, (_match, attrs: string) => {
    const rest = attrs
      .replace(/\swidth\s*=\s*(?:"[^"]*"|'[^']*')/iu, '')
      .replace(/\sheight\s*=\s*(?:"[^"]*"|'[^']*')/iu, '')
    return `<svg width="${size.width}" height="${size.height}"${rest}>`
  })
}

/** Turn standalone SVG into a 2× PNG blob through a canvas. */
async function rasterizePng(svg: string): Promise<Blob> {
  const size = viewBoxSize(svg) ?? { width: 1200, height: 800 }
  const scale = 2
  const markup = rasterMarkup(svg, size)
  // A blob: URL taints the canvas in Chromium when it wraps an SVG (verified in
  // the drawio-chat work), so the raster source is a data: URL instead.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => { resolve() }
    image.onerror = () => { reject(new Error('could not decode the diagram SVG')) }
    image.src = url
  })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(size.width * scale)
  canvas.height = Math.round(size.height * scale)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D canvas is not available')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>(resolve => { canvas.toBlob(resolve, 'image/png') })
  if (blob === null) throw new Error('could not encode the PNG')
  return blob
}

/** Export actions for one saved diagram card. */
export interface DiagramExportActions {
  downloadHtml: () => void
  exportSvg: () => void
  exportPng: () => void
  open: () => void
  busy: boolean
}

/** Wire the card buttons to the host routes. */
export function useDiagramExport(path: string | undefined, title: string | undefined, onError: (message: string) => void): DiagramExportActions {
  const [busy, setBusy] = useState(false)
  const errorRef = useRef(onError)
  errorRef.current = onError
  const stem = fileStem(title)

  const run = useCallback((work: () => Promise<void>): void => {
    if (path === undefined || busy) return
    setBusy(true)
    work()
      .catch((error: unknown) => {
        errorRef.current(tt('ai.exportFailed', { error: error instanceof Error ? error.message : String(error) }))
      })
      .finally(() => { setBusy(false) })
  }, [busy, path])

  return {
    downloadHtml: () => run(async () => {
      const html = await fetchText(rawUrl(path!))
      download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${stem}.html`)
    }),
    exportSvg: () => run(async () => {
      const svg = sanitizeSvg(await fetchText(svgUrl(path!, 'google')))
      download(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${stem}.svg`)
    }),
    exportPng: () => run(async () => {
      const svg = sanitizeSvg(await fetchText(svgUrl(path!, 'none')))
      download(await rasterizePng(svg), `${stem}.png`)
    }),
    open: () => {
      if (path === undefined) return
      window.open(rawUrl(path), '_blank', 'noopener,noreferrer')
    },
    busy,
  }
}
