import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GalleryPanel } from '../src/client/GalleryPanel.tsx'

const TYPES = [
  { slug: 'flowchart', title: 'Flowchart', bestFor: 'Branches and decisions.', example: 'example-flowchart.html' },
  { slug: 'sequence', title: 'Sequence', bestFor: 'Request/response flows over time.' },
]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  document.documentElement.lang = 'en'
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ count: TYPES.length, types: TYPES }),
  })))
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } })
})

afterEach(() => {
  act(() => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
  document.documentElement.lang = ''
})

describe('GalleryPanel', () => {
  it('renders the type list with examples and copies a prompt', async () => {
    await act(async () => { root.render(<GalleryPanel />) })
    await act(async () => { await Promise.resolve() })

    expect(container.textContent).toContain('Flowchart')
    expect(container.textContent).toContain('Sequence')
    expect(container.textContent).toContain('2 types')

    const buttons = [...container.querySelectorAll('button')]
    const copy = buttons.find(button => button.textContent === 'Copy prompt')!
    await act(async () => { copy.click() })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Draw a Flowchart diagram: ')
    expect(container.textContent).toContain('Prompt copied')
  })

  it('opens the example preview in a sandboxed iframe', async () => {
    await act(async () => { root.render(<GalleryPanel />) })
    await act(async () => { await Promise.resolve() })

    const firstRow = container.querySelectorAll('li')[0]
    const preview = [...firstRow.querySelectorAll('button')].find(button => button.textContent === 'Preview')!
    expect(preview.disabled).toBe(false)
    await act(async () => { preview.click() })

    const iframe = container.querySelector('iframe')!
    expect(iframe.getAttribute('src')).toBe('/api/dsh-ai-diagrams/asset?name=example-flowchart.html')
    expect(iframe.getAttribute('sandbox')).toBe('')
  })
})
