/**
 * Standalone tsdown config for the ai-diagrams plugin.
 *
 * Node half: lib/index.js (Host plugin: bundled diagram-design skill provider,
 * tools and preview routes). Browser half: lib/client.js (tool-result card with
 * the inline preview and export actions), auto-detected at src/client/index.ts.
 */
import { clientBundle } from './shared/tsdown.client.ts'

export default clientBundle('dsh-ai-diagrams', ['src/index.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-host-webserver',
  ],
})
