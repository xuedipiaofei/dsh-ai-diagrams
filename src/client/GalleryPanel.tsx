/**
 * Right-sidebar gallery: the 50 diagram types bundled with the skill.
 *
 * The index and the example pages come from loopback-only Host routes; example
 * previews load in a `sandbox=""` iframe like the chat card, so a bundled
 * example never executes with access to the GUI origin. "Copy prompt" copies a
 * ready-to-send sentence because there is no public composer-insertion API.
 */
import { useEffect, useMemo, useState } from 'react'
import { assetUrl, galleryUrl, type GalleryType } from './contract.ts'
import { tt } from './panel-helpers.ts'
import css from './gallery.module.css'

/** Sentinel used while a clipboard write is failing. */
const COPY_FAILED = '__failed__'

/** Gallery panel body registered under `sidebar.right.pane.tab`. */
export function GalleryPanel(): React.JSX.Element {
  const [types, setTypes] = useState<GalleryType[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<GalleryType | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch(galleryUrl())
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
        return await response.json() as { types?: GalleryType[] }
      })
      .then((data) => {
        if (active) setTypes(Array.isArray(data.types) ? data.types : [])
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { active = false }
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = types ?? []
    if (needle === '') return list
    return list.filter(type => `${type.slug} ${type.title} ${type.bestFor}`.toLowerCase().includes(needle))
  }, [types, query])

  const copy = async (type: GalleryType): Promise<void> => {
    const text = tt('gallery.prompt', { title: type.title })
    try {
      await navigator.clipboard.writeText(text)
      setCopied(type.slug)
    } catch {
      setCopied(COPY_FAILED)
    }
    window.setTimeout(() => { setCopied(current => (current === type.slug || current === COPY_FAILED ? null : current)) }, 1600)
  }

  return (
    <div className={css.panel} data-dsh-part="ai-diagrams-gallery">
      <header className={css.header}>
        <div className={css.titleRow}>
          <h2 className={css.heading}>{tt('gallery.title')}</h2>
          <span className={css.count}>{tt('gallery.count', { count: filtered.length })}</span>
        </div>
        <input
          className={css.search}
          type="search"
          value={query}
          placeholder={tt('gallery.search')}
          aria-label={tt('gallery.search')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
      </header>

      {error !== null && <p className={css.error}>{tt('gallery.failed', { error })}</p>}
      {error === null && types === null && <p className={css.status}>{tt('gallery.loading')}</p>}
      {types !== null && filtered.length === 0 && <p className={css.status}>{tt('gallery.empty')}</p>}

      <ul className={css.list}>
        {filtered.map(type => (
          <li key={type.slug} className={css.row}>
            <div className={css.rowMain}>
              <span className={css.rowTitle}>{type.title}</span>
              {type.bestFor !== '' && <span className={css.rowHint}>{type.bestFor}</span>}
            </div>
            <div className={css.rowActions}>
              <button
                type="button"
                className={css.action}
                disabled={type.example === undefined}
                title={type.example === undefined ? tt('gallery.noExample') : type.title}
                onClick={() => { setSelected(type) }}
              >
                {tt('gallery.preview')}
              </button>
              <button type="button" className={css.action} onClick={() => { void copy(type) }}>
                {copied === type.slug ? tt('gallery.copied') : copied === COPY_FAILED ? tt('gallery.copyFailed') : tt('gallery.copy')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {selected !== null && (
        <div className={css.overlay} role="dialog" aria-label={selected.title}>
          <div className={css.previewHead}>
            <span className={css.previewTitle}>{selected.title}</span>
            <button type="button" className={css.action} onClick={() => { setSelected(null) }}>
              {tt('gallery.close')}
            </button>
          </div>
          {selected.example === undefined
            ? <p className={css.status}>{tt('gallery.noExample')}</p>
            : (
                <iframe
                  className={css.previewFrame}
                  title={selected.title}
                  src={assetUrl(selected.example)}
                  sandbox=""
                  referrerPolicy="no-referrer"
                />
              )}
        </div>
      )}
    </div>
  )
}
