/**
 * Browser half of the ai-diagrams plugin:
 * - the tool view that renders `diagram_save` results as an inline diagram card
 *   with export actions;
 * - a right-sidebar gallery page listing the bundled diagram types.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.slots merge.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { DiagramCard } from './DiagramCard.tsx'
import { GalleryPanel } from './GalleryPanel.tsx'
import { GALLERY_KIND, SAVE_TOOL } from './contract.ts'
import { tt } from './panel-helpers.ts'

/** Required services (the runtime must be up first). */
export const inject = ['slots', 'sidebarRightTabs']

/** Identity of the gallery tab type (also its body slot key). */
const GALLERY_ID = 'dsh-ai-diagrams/gallery'

/** Structural view of the slot registry service. */
interface SlotRegistryFace {
  inject: (name: string, callback: () => () => void) => () => void
  register: (options: { name: string; key: string }, component: unknown) => () => void
}

/** Structural view of the sidebar tab-type registry. */
interface SidebarTabRegistryFace {
  register: (definition: {
    id: string
    kind: string
    title: (address: string) => string
    guide?: { id: string; title: string; description?: string }[]
  }) => () => void
}

/**
 * Mount the diagram card and the sidebar gallery.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      const slots = (ctx as unknown as { slots: SlotRegistryFace }).slots
      return slots.inject('tool.call.toolview', () => slots.register({ name: 'tool.call.toolview', key: SAVE_TOOL }, DiagramCard))
    } catch (error) {
      // Registration problems degrade the card to the generic tool row.
      console.warn('[ai-diagrams] tool view registration failed:', error)
      return () => {}
    }
  }, 'ai-diagrams: tool view')

  ctx.effect(() => {
    try {
      const tabs = (ctx as unknown as { sidebarRightTabs: SidebarTabRegistryFace }).sidebarRightTabs
      const slots = (ctx as unknown as { slots: SlotRegistryFace }).slots
      const disposeType = tabs.register({
        id: GALLERY_ID,
        kind: GALLERY_KIND,
        title: () => tt('gallery.title'),
        guide: [{
          id: 'gallery',
          title: () => tt('gallery.guideTitle'),
          description: () => tt('gallery.guideDescription'),
        }],
      })
      const disposeBody = slots.inject('sidebar.right.pane.tab', () => slots.register(
        { name: 'sidebar.right.pane.tab', key: GALLERY_ID },
        GalleryPanel,
      ))
      return () => {
        disposeBody()
        disposeType()
      }
    } catch (error) {
      // A missing sidebar service must not take the diagram card down.
      console.warn('[ai-diagrams] gallery registration failed:', error)
      return () => {}
    }
  }, 'ai-diagrams: gallery sidebar')
}
