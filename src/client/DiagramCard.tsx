/**
 * Tool view for `diagram_save`: the saved diagram rendered in a sandboxed
 * iframe, with HTML/SVG/PNG export and open-in-browser actions.
 *
 * The iframe is deliberately `sandbox=""` (no scripts, no same-origin): the
 * document comes from the model and only static HTML/SVG diagrams pass the
 * validator, so it never executes with access to the GUI origin.
 */
import { useMemo, useState } from 'react'
import { rawUrl } from './contract.ts'
import { tt } from './panel-helpers.ts'
import { useDiagramExport } from './useDiagramExport.ts'
import css from './diagram.module.css'

/** Minimal result metadata handed over from the host tool. */
export interface DiagramMeta {
  title?: string
  path?: string
  bytes?: number
}

/** Props accepted from the `tool.call.toolview` slot (subset we use). */
export interface DiagramCardProps {
  phase?: 'preparing' | 'start' | 'result'
  block?: {
    args?: unknown
    meta?: unknown
    content?: readonly { type: string; text?: string }[]
    isError?: boolean
  }
  toolName?: string
}

/** The diagram card. */
export function DiagramCard({ phase, block }: DiagramCardProps): React.JSX.Element {
  const meta = useMemo<DiagramMeta>(() => {
    const raw = block?.meta
    return raw !== null && typeof raw === 'object' ? raw as DiagramMeta : {}
  }, [block?.meta])
  const [error, setError] = useState<string | undefined>(undefined)
  const [expanded, setExpanded] = useState(false)
  const actions = useDiagramExport(meta.path, meta.title, setError)
  const ready = phase === 'result' && meta.path !== undefined
  const title = meta.title !== undefined && meta.title !== '' ? meta.title : 'diagram'

  return (
    <div className={css.card} data-dsh-part="ai-diagrams-card">
      <div className={css.head}>
        <span className={css.title}>{tt('ai.title')}</span>
        <span className={css.subtitle}>{ready ? title : tt('ai.loading')}</span>
        <span className={css.spacer} />
        {ready && (
          <>
            <span className={css.badge}>HTML · SVG</span>
            <button type="button" className={css.action} onClick={actions.downloadHtml} data-busy={actions.busy ? '' : undefined}>{tt('ai.downloadHtml')}</button>
            <button type="button" className={css.action} onClick={actions.exportSvg} data-busy={actions.busy ? '' : undefined}>{tt('ai.exportSvg')}</button>
            <button type="button" className={css.action} onClick={actions.exportPng} data-busy={actions.busy ? '' : undefined}>{tt('ai.exportPng')}</button>
            <button type="button" className={css.action} onClick={actions.open}>{tt('ai.open')}</button>
            <button type="button" className={css.action} onClick={() => { setExpanded(value => !value) }}>
              {expanded ? tt('ai.collapse') : tt('ai.expand')}
            </button>
          </>
        )}
      </div>
      {error !== undefined && <p className={css.error}>{error}</p>}
      <div className={css.frameWrap} data-expanded={expanded ? '' : undefined}>
        {ready
          ? (
              <iframe
                className={css.frame}
                title={title}
                src={rawUrl(meta.path!)}
                sandbox=""
                referrerPolicy="no-referrer"
                loading="lazy"
              />
            )
          : <p className={css.status}>{tt('ai.loading')}</p>}
      </div>
      {ready && <p className={css.path}>{meta.path}</p>}
    </div>
  )
}
