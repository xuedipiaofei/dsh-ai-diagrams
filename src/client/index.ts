/**
 * Browser half of the ai-diagrams plugin: registers the tool view that renders
 * `diagram_save` results as an inline diagram card with export actions.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.slots merge.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { DiagramCard } from './DiagramCard.tsx'
import { SAVE_TOOL } from './contract.ts'

/** Required services (the runtime must be up first). */
export const inject = ['slots']

/** Structural view of the slot registry service. */
interface SlotRegistryFace {
  inject: (name: string, callback: () => () => void) => () => void
  register: (options: { name: string; key: string }, component: unknown) => () => void
}

/**
 * Mount the diagram card.
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
}
