import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { apply, ROUTES, TOOL_NAMES } from '../src/index.ts'

/** Valid static diagram used by the save/preview path. */
const DIAGRAM = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Login flow</title>
  <link href="https://fonts.googleapis.com/css2?family=Geist&display=swap" rel="stylesheet">
</head>
<body>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" role="img" aria-labelledby="t d">
    <title id="t">Login flow</title>
    <desc id="d">Sign in and reach the home page.</desc>
    <rect x="20" y="20" width="120" height="48" rx="4" fill="#ffffff" stroke="#2d3142"/>
  </svg>
</body>
</html>`

const workspace = mkdtempSync(join(tmpdir(), 'ai-diagrams-test-'))
afterAll(() => { rmSync(workspace, { recursive: true, force: true }) })

/** One route registration captured from the stub web server. */
interface CapturedRoute {
  kind: string
  path: string
  handler: (req: any, res: any) => void
}

/** Build a structural cordis context plus captured registrations. */
function makeContext(cwd: string): {
  ctx: any
  tools: Map<string, any>
  routes: CapturedRoute[]
  provider: () => any
} {
  const tools = new Map<string, any>()
  const routes: CapturedRoute[] = []
  let providerFactory: (() => any) | undefined
  const ctx: any = {
    effect: (callback: () => any) => { callback(); return { dispose: () => {} } },
    get: (name: string) => name === 'workingDirectory' ? { ensure: async () => cwd } : undefined,
    tools: { register: (definition: any) => { tools.set(definition.name, definition) } },
    webServer: { register: (route: CapturedRoute) => { routes.push(route); return () => {} } },
    skills: { registerProvider: (factory: () => any) => { providerFactory = factory; return () => {} } },
  }
  return { ctx, tools, routes, provider: () => providerFactory?.() }
}

/** Minimal ServerResponse stand-in capturing the written payload. */
function fakeResponse(): { res: any; result: () => { status: number; headers: Record<string, string>; body: string } } {
  const state = { status: 0, headers: {} as Record<string, string>, body: '' }
  const res = {
    writeHead: (status: number, headers?: Record<string, string>) => { state.status = status; state.headers = headers ?? {} },
    end: (body?: unknown) => { state.body = body === undefined ? '' : String(body) },
  }
  return { res, result: () => state }
}

/** Minimal IncomingMessage stand-in for a loopback GET. */
function fakeRequest(url: string, remoteAddress = '127.0.0.1'): any {
  return { method: 'GET', url, socket: { remoteAddress } }
}

describe('host plugin wiring', () => {
  it('registers the bundled skill, four tools and the preview routes', async () => {
    const { ctx, tools, routes, provider } = makeContext(workspace)
    apply(ctx)
    expect([...tools.keys()].sort()).toEqual(Object.values(TOOL_NAMES).sort())
    expect(routes.map(route => route.path)).toEqual(Object.values(ROUTES))
    const skillProvider = provider()
    expect(skillProvider.name).toBe('dsh-ai-diagrams')
    const candidates = await skillProvider.list()
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ name: 'diagram-design', source: 'bundled', rank: 600 })
    expect(candidates[0].resourceBase.kind).toBe('directory')
    const skill = await skillProvider.get()
    expect(skill.content).toContain('# Diagram Design')
    expect(skill.content).toContain('DeepSeek Harness tools')
  })

  it('saves a diagram, previews it and exports its SVG', async () => {
    const { ctx, tools, routes } = makeContext(workspace)
    apply(ctx)

    const saved = await tools.get(TOOL_NAMES.save).execute({ html: DIAGRAM, title: 'Login flow' }, { agent: {}, signal: undefined })
    expect(saved.title).toBe('Login flow')
    expect(saved.bytes).toBe(Buffer.byteLength(DIAGRAM, 'utf8'))
    expect(existsSync(saved.path)).toBe(true)
    expect(readFileSync(saved.path, 'utf8')).toBe(DIAGRAM)

    const raw = routes.find(route => route.path === ROUTES.raw)!
    const rawResponse = fakeResponse()
    raw.handler(fakeRequest(`${ROUTES.raw}?path=${encodeURIComponent(saved.path)}`), rawResponse.res)
    expect(rawResponse.result().status).toBe(200)
    expect(rawResponse.result().headers['content-type']).toContain('text/html')
    expect(rawResponse.result().body).toContain('<!DOCTYPE html>')

    const svg = routes.find(route => route.path === ROUTES.svg)!
    const svgResponse = fakeResponse()
    svg.handler(fakeRequest(`${ROUTES.svg}?path=${encodeURIComponent(saved.path)}&fonts=none`), svgResponse.res)
    expect(svgResponse.result().status).toBe(200)
    expect(svgResponse.result().body).toContain('<svg')
    expect(svgResponse.result().body).not.toContain('fonts.googleapis.com')

    // The preview routes are not a general file reader.
    const escaped = fakeResponse()
    raw.handler(fakeRequest(`${ROUTES.raw}?path=${encodeURIComponent('/etc/passwd')}`), escaped.res)
    expect(escaped.result().status).toBe(403)

    const remote = fakeResponse()
    raw.handler(fakeRequest(`${ROUTES.raw}?path=${encodeURIComponent(saved.path)}`, '10.0.0.9'), remote.res)
    expect(remote.result().status).toBe(403)
  })

  it('rejects a diagram that breaks the contract', async () => {
    const { ctx, tools } = makeContext(workspace)
    apply(ctx)
    await expect(tools.get(TOOL_NAMES.save).execute({ html: DIAGRAM.replace('</body>', '<script>x()</script></body>') }, { agent: {}, signal: undefined }))
      .rejects.toThrow(/single-file\/accessible contract/)
  })

  it('exports SVG and validates a saved file by path', async () => {
    const { ctx, tools } = makeContext(workspace)
    apply(ctx)
    const saved = await tools.get(TOOL_NAMES.save).execute({ html: DIAGRAM, title: 'Login flow' }, { agent: {}, signal: undefined })
    const exported = await tools.get(TOOL_NAMES.svg).execute({ path: saved.path, fonts: 'google' }, { agent: {}, signal: undefined })
    expect(existsSync(exported.path)).toBe(true)
    expect(readFileSync(exported.path, 'utf8')).toContain('fonts.googleapis.com')
    const checked = await tools.get(TOOL_NAMES.validate).execute({ path: saved.path }, { agent: {}, signal: undefined })
    expect(checked.ok).toBe(true)
  })

  it('imports a source diagram from the workspace', async () => {
    const { ctx, tools } = makeContext(workspace)
    apply(ctx)
    const source = join(workspace, 'flow.mmd')
    writeFileSync(source, 'flowchart LR\n  A[User] --> B{Login}\n  B -->|yes| C[Home]\n', 'utf8')
    const digest = await tools.get(TOOL_NAMES.import).execute({ path: 'flow.mmd' }, { agent: {}, signal: undefined })
    expect(digest.format).toBe('mermaid')
    expect(digest.nodes).toBeGreaterThanOrEqual(3)
    expect(digest.digest).toContain('edge')
  })
})
