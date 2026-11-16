/**
 * Host half of the dsh-ai-diagrams plugin.
 *
 * One bundled skill + seven tools:
 * - the `diagram-design` agent skill (full upstream skill, registered through
 *   `ctx.skills.registerProvider` so the model can load it like any local skill);
 * - `diagram_save`      validate + save a generated HTML diagram, render it inline;
 * - `diagram_svg`       export the diagram SVG from a saved HTML file;
 * - `diagram_validate`  check a diagram HTML against the accessible/safety contract;
 * - `diagram_import`    extract a structural digest from draw.io / Mermaid /
 *                       Excalidraw / PlantUML sources so the model can redraw them;
 * - `diagram_types`     search the 50 bundled diagram types;
 * - `diagram_profile`   fetch a site's palette/fonts into a reusable brand profile;
 * - `diagram_png`       rasterize a saved diagram into a workspace PNG.
 *
 * The plugin never runs the skill's Python helpers: the parts DSH needs (verify,
 * SVG export, source extraction, PNG via the browser) are TypeScript here.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { buildTypeIndex, type DiagramType } from './core/gallery.ts'
import { importDiagram, renderDigest } from './core/import.ts'
import { findBrowser, renderPng } from './core/png.ts'
import { extractBrandProfile, profilePath, renderProfile, safeProfileName } from './core/profile.ts'
import { extractDiagramSvg } from './core/svg.ts'
import { renderValidation, validateDiagramHtml, type ValidationResult } from './core/validate.ts'

/** Stable cordis plugin name. */
export const name = 'ai-diagrams'

/** Host services required before the plugin can apply. */
export const inject = ['webServer', 'tools', 'skills']

/** Route family served by this plugin. */
export const ROUTES = {
  health: '/api/dsh-ai-diagrams/health',
  /** Saved diagram HTML for the chat card preview and browser open. */
  raw: '/api/dsh-ai-diagrams/raw',
  /** Standalone SVG export of a saved diagram. */
  svg: '/api/dsh-ai-diagrams/svg',
  /** Diagram-type index for the gallery panel. */
  gallery: '/api/dsh-ai-diagrams/gallery',
  /** One bundled example page from the skill's assets directory. */
  asset: '/api/dsh-ai-diagrams/asset',
} as const

/** Tool names shared with the browser half. */
export const TOOL_NAMES = {
  save: 'diagram_save',
  svg: 'diagram_svg',
  validate: 'diagram_validate',
  import: 'diagram_import',
  types: 'diagram_types',
  profile: 'diagram_profile',
  png: 'diagram_png',
} as const

/** Sidebar gallery kind opened by the client guide entry. */
export const GALLERY_KIND = 'diagrams-gallery'

/** Resolve the vendored agent skill directory (package-relative; cwd fallback under test runners). */
function resolveSkillDir(): string {
  try {
    return fileURLToPath(new URL('../skills/diagram-design/', import.meta.url))
  } catch {
    return resolve(process.cwd(), 'skills', 'diagram-design')
  }
}

/** The vendored agent skill directory (ships inside the package). */
const SKILL_DIR = resolveSkillDir()

/** Kebab-case skill name addressed by the `skill` tool. */
const SKILL_NAME = 'diagram-design'

/** Routing description for the bundled skill (capped by the session catalog). */
const SKILL_DESCRIPTION =
  'Create editorial diagrams as one self-contained HTML file with inline SVG: architecture, flowcharts, sequence, state, ER, timeline, swimlane, quadrant, charts and many more types; redraw .drawio / Mermaid / Excalidraw / PlantUML; export SVG/PNG; match a site brand. Use for diagrams that will be published (docs, slides, README, blog). In DSH prefer the diagram_save / diagram_svg / diagram_validate / diagram_import tools over the packaged Python scripts.'

/** Caps for files this plugin reads. */
const MAX_DIAGRAM_BYTES = 2 * 1024 * 1024
/** Caps for imported source diagrams. */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024

/** Known diagram files per session workspace (newest last). */
const lastByCwd = new Map<string, string>()

/** Files this process wrote; the preview routes serve only these. */
const knownFiles = new Set<string>()

/** Cap for a fetched brand page. */
const MAX_BRAND_BYTES = 1024 * 1024

/** Cached diagram-type index (the vendored skill is static). */
let typeIndexCache: DiagramType[] | undefined

/** Read the type index once per process. */
function getTypes(): DiagramType[] {
  typeIndexCache ??= buildTypeIndex(SKILL_DIR)
  return typeIndexCache
}

/** Example asset names the gallery may preview (no arbitrary file reads). */
function exampleAssets(): Set<string> {
  const names = new Set<string>()
  for (const type of getTypes()) {
    if (type.example !== undefined) names.add(type.example)
  }
  return names
}

/** Brand profile directory under the DSH home. */
function brandProfileDir(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'editorial-diagrams', 'profiles')
}

/** One saved brand profile summary. */
interface ProfileSummary {
  name: string
  title?: string
  source?: string
  fetched?: string
}

/** List saved brand profiles. */
function listProfiles(dir: string): ProfileSummary[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.toLowerCase().endsWith('.md'))
    .sort()
    .map((file) => {
      const name = file.replace(/\.md$/iu, '')
      let text = ''
      try {
        text = readFileSync(join(dir, file), 'utf8')
      } catch {
        return { name }
      }
      const title = /^-\s*title:\s*(.+)$/mu.exec(text)?.[1]?.trim()
      const source = /^-\s*source:\s*(.+)$/mu.exec(text)?.[1]?.trim()
      const fetched = /^-\s*fetched:\s*(.+)$/mu.exec(text)?.[1]?.trim()
      return {
        name,
        ...(title === undefined ? {} : { title }),
        ...(source === undefined ? {} : { source }),
        ...(fetched === undefined ? {} : { fetched }),
      }
    })
}

/** Whether an IPv4 literal is loopback/private/link-local. */
function isPrivateIPv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(host)
  if (match === null) return false
  const octets = match.slice(1).map(Number)
  if (octets.some(value => value > 255)) return true
  const [a, b] = octets
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
}

/** Reject non-public URLs before the Host fetches a user-supplied page. */
function assertPublicHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('url must be a valid http(s) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('url must start with http:// or https://')
  if (url.username !== '' || url.password !== '') throw new Error('url must not contain credentials')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('url must point at a public site')
  if (host === '::1' || host === '::' || host === '0.0.0.0') throw new Error('url must point at a public site')
  if (isPrivateIPv4(host)) throw new Error('url must point at a public site')
  if (/^(fc|fd|fe80)/u.test(host)) throw new Error('url must point at a public site')
  return url
}

/** Fetch one HTML page with a hard byte cap and timeout. */
async function fetchBrandPage(url: URL): Promise<string> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
    headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'dsh-ai-diagrams/0.2 (+brand profile)' },
  })
  if (!response.ok) throw new Error(`fetch failed: HTTP ${String(response.status)}`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!/text\/html|application\/xhtml\+xml/iu.test(contentType)) {
    throw new Error(`not an HTML page (content-type: ${contentType === '' ? 'unknown' : contentType})`)
  }
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BRAND_BYTES) throw new Error(`page exceeds ${String(MAX_BRAND_BYTES)} bytes`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > MAX_BRAND_BYTES) throw new Error(`page exceeds ${String(MAX_BRAND_BYTES)} bytes`)
  return buffer.toString('utf8')
}


/** One tool definition, structurally compatible with `ctx.tools.register`. */
type ToolDefinition = Record<string, unknown>

/** Structural view of the host services we call (no SDK type dependency). */
interface SkillProviderFace {
  registerProvider: (factory: () => unknown) => (() => void) | undefined
}

/** Resolve the workspace directory a tool run belongs to. */
async function resolveCwd(ctx: Context, exec: { agent?: unknown; signal?: unknown }): Promise<string> {
  const faces = ctx as unknown as {
    get?: (name: string) => unknown
    workingDirectory?: unknown
  }
  const candidate = (typeof faces.get === 'function' ? faces.get('workingDirectory') : undefined) ?? faces.workingDirectory
  const wd = candidate as { ensure?: (agent: unknown, signal: unknown) => Promise<string> } | undefined
  if (wd !== undefined && typeof wd.ensure === 'function' && exec.agent !== undefined) {
    try {
      return await wd.ensure(exec.agent, exec.signal)
    } catch {
      // Fall through to the process cwd; the tool still renders the diagram.
    }
  }
  return process.cwd()
}

/** kebab file base for a diagram title. */
function slug(title: string): string {
  const ascii = title.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '')
  return ascii === '' ? 'diagram' : ascii.slice(0, 60)
}

/** Write a file atomically (same-directory temp + rename). */
function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temporary, content, 'utf8')
  renameSync(temporary, path)
}

/** Resolve a workspace-relative path without escaping the workspace. */
function workspacePath(cwd: string, input: string): string {
  const absolute = isAbsolute(input) ? resolve(input) : resolve(cwd, input)
  const rel = relative(cwd, absolute)
  if (rel.startsWith('..') || rel.split(sep).includes('..')) throw new Error(`path escapes the session workspace: ${input}`)
  return absolute
}

/** Read a saved diagram HTML file with size checks. */
function readDiagramHtml(path: string): string {
  if (!existsSync(path)) throw new Error(`diagram not found: ${path}`)
  const content = readFileSync(path, 'utf8')
  if (Buffer.byteLength(content, 'utf8') > MAX_DIAGRAM_BYTES) throw new Error(`diagram exceeds ${MAX_DIAGRAM_BYTES} bytes: ${path}`)
  return content
}

/** Resolve the target diagram from an explicit path or the session's latest one. */
async function targetDiagram(ctx: Context, exec: { agent?: unknown; signal?: unknown }, input: unknown): Promise<{ path: string; cwd: string }> {
  const cwd = await resolveCwd(ctx, exec)
  if (typeof input === 'string' && input.trim() !== '') {
    const path = workspacePath(cwd, input.trim())
    if (!path.toLowerCase().endsWith('.html')) throw new Error('diagram path must end with .html')
    return { path, cwd }
  }
  const last = lastByCwd.get(cwd)
  if (last === undefined) throw new Error('no diagram yet in this workspace: call diagram_save first or pass an explicit .html path')
  return { path: last, cwd }
}

/** Build the bundled skill provider. */
function skillProvider(): unknown {
  return {
    name: 'dsh-ai-diagrams',
    list: () => Promise.resolve([{
      name: SKILL_NAME,
      description: SKILL_DESCRIPTION,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'dsh-ai-diagrams',
      source: 'bundled',
      resourceBase: { kind: 'directory', path: SKILL_DIR },
      rank: 600,
      locator: SKILL_DIR,
    }]),
    async get(): Promise<unknown> {
      return {
        name: SKILL_NAME,
        description: SKILL_DESCRIPTION,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: 'dsh-ai-diagrams',
        source: 'bundled',
        resourceBase: { kind: 'directory', path: SKILL_DIR },
        content: readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8'),
      }
    },
  }
}

/** Guard one preview route: loopback only, GET only. */
function previewGuard(req: IncomingMessage, res: ServerResponse, writeError: (status: number, message: string) => void): boolean {
  if (req.method !== 'GET') {
    writeError(405, 'method not allowed')
    return false
  }
  const remote = req.socket.remoteAddress ?? ''
  if (!(remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1')) {
    writeError(403, 'preview route is loopback-only')
    return false
  }
  return true
}

/** Parse one validation result into a serializable value. */
function validationValue(result: ValidationResult): { ok: boolean; errors: string[]; warnings: string[]; svgCount: number } {
  return {
    ok: result.ok,
    errors: result.errors.map(issue => `[${issue.code}] ${issue.message}`),
    warnings: result.warnings.map(issue => `[${issue.code}] ${issue.message}`),
    svgCount: result.svgCount,
  }
}

/**
 * Register the plugin's host surfaces.
 * @param ctx - host context with webServer, tools and skills services.
 */
export function apply(ctx: Context): void {
  // ── bundled diary-design skill ────────────────────────────────────────────
  ctx.effect(() => {
    const skills = (ctx as unknown as { skills: SkillProviderFace }).skills
    const dispose = skills.registerProvider(() => skillProvider())
    return () => { if (typeof dispose === 'function') dispose() }
  }, 'ai-diagrams: bundled skill')

  // ── preview routes (loopback only, only files this process saved) ─────────
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTES.health,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, plugin: name }))
    },
  }), 'ai-diagrams: health route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTES.raw,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const writeError = (status: number, message: string): void => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: message }))
      }
      if (!previewGuard(req, res, writeError)) return
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const path = url.searchParams.get('path') ?? ''
      if (path === '' || !knownFiles.has(path) || !path.toLowerCase().endsWith('.html')) {
        writeError(403, 'file is not part of this session')
        return
      }
      try {
        const content = readDiagramHtml(path)
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          // Diagrams are static; fonts are the only allowed remote resource.
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'",
        })
        res.end(content)
      } catch (error) {
        writeError(404, error instanceof Error ? error.message : 'diagram not found')
      }
    },
  }), 'ai-diagrams: raw route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTES.svg,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const writeError = (status: number, message: string): void => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: message }))
      }
      if (!previewGuard(req, res, writeError)) return
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const path = url.searchParams.get('path') ?? ''
      if (path === '' || !knownFiles.has(path) || !path.toLowerCase().endsWith('.html')) {
        writeError(403, 'file is not part of this session')
        return
      }
      try {
        const exported = extractDiagramSvg(readDiagramHtml(path), { fonts: url.searchParams.get('fonts') === 'none' ? 'none' : 'google' })
        res.writeHead(200, {
          'content-type': 'image/svg+xml; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        res.end(exported.svg)
      } catch (error) {
        writeError(404, error instanceof Error ? error.message : 'SVG export failed')
      }
    },
  }), 'ai-diagrams: svg route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTES.gallery,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: 'method not allowed' }))
        return
      }
      const types = getTypes()
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      res.end(JSON.stringify({ count: types.length, types }))
    },
  }), 'ai-diagrams: gallery route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTES.asset,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const writeError = (status: number, message: string): void => {
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: message }))
      }
      if (!previewGuard(req, res, writeError)) return
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const name = url.searchParams.get('name') ?? ''
      if (!exampleAssets().has(name)) {
        writeError(403, 'unknown example asset')
        return
      }
      try {
        const content = readFileSync(join(SKILL_DIR, 'assets', name), 'utf8')
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'",
        })
        res.end(content)
      } catch (error) {
        writeError(404, error instanceof Error ? error.message : 'example not found')
      }
    },
  }), 'ai-diagrams: asset route')

  // ── tools ─────────────────────────────────────────────────────────────────
  const tools = (ctx as unknown as { tools: { register(definition: ToolDefinition): unknown } }).tools

  tools.register({
    name: TOOL_NAMES.save,
    description: 'Validate and save a self-contained diagram HTML file (as written with the diagram-design skill) into the workspace "diagrams/" folder, then render it inline in the chat with download/export actions. Use this once the diagram document is complete; the tool rejects static diagrams that contain scripts, remote resources, or a broken accessible-SVG contract, and returns the exact errors to fix.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        html: { type: 'string', description: 'The complete diagram HTML document (DOCTYPE html ... </html>).' },
        title: { type: 'string', description: 'Optional diagram title, used for the file name and card header.' },
        fileName: { type: 'string', description: 'Optional file base (letters, digits and dashes); defaults to a slug of the title.' },
      },
      required: ['html'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          path: { type: 'string' },
          bytes: { type: 'integer' },
          svgCount: { type: 'integer' },
          warnings: { type: 'array' },
        },
        required: ['title', 'path', 'bytes'],
      },
      render: (_args: unknown, value: { title: string; path: string; bytes: number; warnings: string[] }) => [{
        type: 'text',
        text: `Saved "${value.title}" at ${value.path} (${value.bytes} bytes). The chat card renders it; use diagram_svg for an .svg file.${value.warnings.length === 0 ? '' : `\nWarnings:\n${value.warnings.join('\n')}`}`,
      }],
      presentationMeta: (_args: unknown, value: { title: string; path: string }) => ({ title: value.title, path: value.path }),
    },
    execute: async (args: { html?: unknown; title?: unknown; fileName?: unknown }, exec: { agent?: unknown; signal?: unknown }) => {
      const html = typeof args.html === 'string' ? args.html : ''
      if (html.trim() === '') throw new Error('html is required and must be the complete diagram document')
      const result = validateDiagramHtml(html)
      if (!result.ok) {
        throw new Error(`diagram does not pass the single-file/accessible contract:\n${renderValidation(result)}`)
      }
      const title = typeof args.title === 'string' && args.title.trim() !== ''
        ? args.title.trim()
        : (result.title !== undefined && result.title !== '' ? result.title : 'diagram')
      const requestedBase = typeof args.fileName === 'string' ? args.fileName.trim() : ''
      const base = requestedBase.replace(/[^a-zA-Z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '') || slug(title)
      const cwd = await resolveCwd(ctx, exec)
      const digest = createHash('sha1').update(html).digest('hex').slice(0, 8)
      const path = join(cwd, 'diagrams', `${base}-${digest}.html`)
      atomicWrite(path, html)
      lastByCwd.set(cwd, path)
      knownFiles.add(path)
      return {
        title,
        path,
        bytes: Buffer.byteLength(html, 'utf8'),
        svgCount: result.svgCount,
        warnings: result.warnings.map(issue => `[${issue.code}] ${issue.message}`),
      }
    },
  })

  tools.register({
    name: TOOL_NAMES.svg,
    description: 'Export the diagram SVG from a saved diagram HTML file into a standalone .svg file in the workspace. The exported SVG contains only the diagram (no page chrome or editorial cards), which is what Figma/slides need. Prefer this over asking the user to copy SVG by hand.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Workspace-relative .html path; defaults to the latest diagram saved in this session.' },
        fonts: { type: 'string', enum: ['google', 'none'], description: 'Embed the Google Fonts @import (default google) or keep the SVG offline-friendly with none.' },
        output: { type: 'string', description: 'Optional workspace-relative .svg output path; defaults to diagrams/<name>.svg next to the HTML.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          bytes: { type: 'integer' },
          title: { type: 'string' },
          warnings: { type: 'array' },
        },
        required: ['path', 'bytes'],
      },
      render: (_args: unknown, value: { path: string; bytes: number; warnings: string[] }) => [{
        type: 'text',
        text: `Exported ${value.path} (${value.bytes} bytes).${value.warnings.length === 0 ? '' : `\nWarnings:\n${value.warnings.join('\n')}`}`,
      }],
    },
    execute: async (args: { path?: unknown; fonts?: unknown; output?: unknown }, exec: { agent?: unknown; signal?: unknown }) => {
      const target = await targetDiagram(ctx, exec, args.path)
      const exported = extractDiagramSvg(readDiagramHtml(target.path), { fonts: args.fonts === 'none' ? 'none' : 'google' })
      const output = typeof args.output === 'string' && args.output.trim() !== ''
        ? workspacePath(target.cwd, args.output.trim())
        : join(target.cwd, 'diagrams', `${target.path.split(sep).pop()!.replace(/\.html$/iu, '')}.svg`)
      atomicWrite(output, exported.svg)
      return {
        path: output,
        bytes: Buffer.byteLength(exported.svg, 'utf8'),
        ...(exported.title === undefined ? {} : { title: exported.title }),
        warnings: exported.warnings,
      }
    },
  })

  tools.register({
    name: TOOL_NAMES.validate,
    description: 'Validate a diagram HTML document against the diagram-design contract used by DSH: complete document, no scripts, no remote resources except Google Fonts, accessible SVG (title first, non-empty title/desc, aria-labelledby, viewBox) and a size cap. Use it before diagram_save, or on an existing saved file to explain why it cannot preview.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        html: { type: 'string', description: 'The HTML document to validate.' },
        path: { type: 'string', description: 'Workspace-relative .html file to validate instead of html.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          errors: { type: 'array' },
          warnings: { type: 'array' },
          svgCount: { type: 'integer' },
        },
        required: ['ok', 'errors', 'warnings', 'svgCount'],
      },
      render: (_args: unknown, value: { ok: boolean; errors: string[]; warnings: string[] }) => [{
        type: 'text',
        text: value.ok
          ? `OK: the document passes the diagram contract.${value.warnings.length === 0 ? '' : `\nWarnings:\n${value.warnings.join('\n')}`}`
          : `The document needs fixes:\n${[...value.errors.map(item => `ERROR ${item}`), ...value.warnings.map(item => `WARN ${item}`)].join('\n')}`,
      }],
    },
    execute: async (args: { html?: unknown; path?: unknown }, exec: { agent?: unknown; signal?: unknown }) => {
      let html: string
      if (typeof args.html === 'string' && args.html.trim() !== '') {
        html = args.html
      } else {
        const target = await targetDiagram(ctx, exec, args.path)
        html = readDiagramHtml(target.path)
      }
      return validationValue(validateDiagramHtml(html))
    },
  })

  tools.register({
    name: TOOL_NAMES.import,
    description: 'Extract a normalized structure digest (nodes, edges, groups, direction hints) from an existing .drawio, Mermaid (.mmd/.mermaid), Excalidraw (.excalidraw) or PlantUML file in the workspace, so you can redraw it in the diagram-design style. Never renders the source; read the digest, pick the matching type reference, then diagram_save the redrawn diagram.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Workspace-relative source file (.drawio, .mmd, .mermaid, .excalidraw, .puml).' },
      },
      required: ['path'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          format: { type: 'string' },
          nodes: { type: 'integer' },
          edges: { type: 'integer' },
          truncated: { type: 'boolean' },
          digest: { type: 'string' },
        },
        required: ['format', 'nodes', 'edges', 'digest'],
      },
      render: (_args: unknown, value: { digest: string }) => [{ type: 'text', text: value.digest }],
    },
    execute: async (args: { path?: unknown }, exec: { agent?: unknown; signal?: unknown }) => {
      if (typeof args.path !== 'string' || args.path.trim() === '') throw new Error('path is required')
      const cwd = await resolveCwd(ctx, exec)
      const path = workspacePath(cwd, args.path.trim())
      if (!existsSync(path)) throw new Error(`source file not found: ${args.path}`)
      const content = readFileSync(path, 'utf8')
      if (Buffer.byteLength(content, 'utf8') > MAX_SOURCE_BYTES) throw new Error(`source file exceeds ${MAX_SOURCE_BYTES} bytes: ${args.path}`)
      const digest = importDiagram(path, content)
      return {
        format: digest.format,
        nodes: digest.nodes.length,
        edges: digest.edges.length,
        truncated: digest.truncated,
        digest: renderDigest(digest),
      }
    },
  })

  tools.register({
    name: TOOL_NAMES.types,
    description: 'List or search the 50 diagram types bundled with the diagram-design skill. Each entry has the type slug (use it in the prompt or in diagram_save), its title and the upstream "Best for" guidance. Prefer this over reading the large type table in SKILL.md; then load the matching references/type-<slug>.md before drawing.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Optional case-insensitive filter on slug, title and "Best for" text (e.g. "sequence", "quadrant", "ER").' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Maximum entries to return (default 50).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer' },
          types: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                slug: { type: 'string' },
                title: { type: 'string' },
                bestFor: { type: 'string' },
                example: { type: 'string' },
              },
              required: ['slug', 'title', 'bestFor'],
            },
          },
        },
        required: ['total', 'types'],
      },
      render: (_args: unknown, value: { total: number; types: { slug: string; title: string; bestFor: string }[] }) => [{
        type: 'text',
        text: value.types.length === 0
          ? 'No diagram type matches that query. Try "flowchart", "architecture", "sequence", "timeline" or a broader word.'
          : [`${String(value.total)} matching type${value.total === 1 ? '' : 's'}:`, ...value.types.map(item => `- ${item.slug} — ${item.title}${item.bestFor === '' ? '' : ` — ${item.bestFor}`}`), '', 'Load references/type-<slug>.md for the chosen type before drawing.'].join('\n'),
      }],
    },
    execute: (args: { query?: unknown; limit?: unknown }) => {
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
      const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.max(1, Math.min(50, Math.trunc(args.limit))) : 50
      const all = getTypes()
      const matched = query === ''
        ? all
        : all.filter(type => `${type.slug} ${type.title} ${type.bestFor}`.toLowerCase().includes(query))
      return {
        total: matched.length,
        types: matched.slice(0, limit).map(type => ({
          slug: type.slug,
          title: type.title,
          bestFor: type.bestFor,
          ...(type.example === undefined ? {} : { example: type.example }),
        })),
      }
    },
  })

  tools.register({
    name: TOOL_NAMES.profile,
    description: 'Manage reusable brand profiles for diagram-design. "fetch" reads a public site and extracts its palette and typefaces into $DSH_HOME/editorial-diagrams/profiles/<name>.md; then read it and apply those tokens to {ink}/{paper}/{accent} and the heading/body fonts. "list"/"get"/"delete" manage saved profiles. Do not fetch private/intranet URLs.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'fetch', 'get', 'delete'], description: 'Operation to perform (default list).' },
        url: { type: 'string', description: 'For action=fetch: the public http(s) page to learn the brand from.' },
        name: { type: 'string', description: 'Profile name (slug). For fetch it defaults to the site hostname; for get/delete it is required.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string' },
          name: { type: 'string' },
          path: { type: 'string' },
          content: { type: 'string' },
          palette: { type: 'array' },
          fonts: { type: 'array' },
          profiles: { type: 'array' },
        },
        required: ['action'],
      },
      render: (_args: unknown, value: { action: string; name?: string; path?: string; content?: string; palette?: unknown[]; fonts?: unknown[]; profiles?: { name: string; title?: string; source?: string }[] }) => {
        if (value.action === 'fetch') {
          return [{ type: 'text', text: `Saved brand profile "${value.name ?? 'profile'}" at ${value.path ?? ''}.\n\n${value.content ?? ''}` }]
        }
        if (value.action === 'get') return [{ type: 'text', text: value.content ?? 'profile not found' }]
        if (value.action === 'delete') return [{ type: 'text', text: `Deleted brand profile "${value.name ?? 'profile'}"${value.path === undefined ? '.' : ` (${value.path}).`}` }]
        const profiles = value.profiles ?? []
        return [{
          type: 'text',
          text: profiles.length === 0
            ? 'No saved brand profiles. Fetch one with action="fetch" and a public URL.'
            : ['Saved brand profiles:', ...profiles.map(profile => `- ${profile.name}${profile.title === undefined ? '' : ` — ${profile.title}`}${profile.source === undefined ? '' : ` (${profile.source})`}`)].join('\n'),
        }]
      },
    },
    execute: async (args: { action?: unknown; url?: unknown; name?: unknown }) => {
      const action = typeof args.action === 'string' && args.action !== '' ? args.action : 'list'
      const dir = brandProfileDir()
      if (action === 'list') {
        return { action, profiles: listProfiles(dir) }
      }
      const rawName = typeof args.name === 'string' ? args.name.trim() : ''
      if (action === 'fetch') {
        if (typeof args.url !== 'string' || args.url.trim() === '') throw new Error('url is required for action="fetch"')
        const url = assertPublicHttpUrl(args.url.trim())
        const html = await fetchBrandPage(url)
        const profile = extractBrandProfile(html, url.toString())
        const name = safeProfileName(rawName === '' ? url.hostname : rawName)
        const path = profilePath(dir, name)
        const content = renderProfile(profile, name)
        atomicWrite(path, content)
        return { action, name, path, content, palette: profile.palette, fonts: profile.fonts }
      }
      if (rawName === '') throw new Error(`name is required for action="${action}"`)
      const name = safeProfileName(rawName)
      const path = profilePath(dir, name)
      if (action === 'get') {
        if (!existsSync(path)) throw new Error(`brand profile not found: ${name}`)
        return { action, name, path, content: readFileSync(path, 'utf8') }
      }
      if (action === 'delete') {
        if (!existsSync(path)) throw new Error(`brand profile not found: ${name}`)
        rmSync(path, { force: true })
        return { action, name, path }
      }
      throw new Error(`unknown action: ${action}`)
    },
  })

  tools.register({
    name: TOOL_NAMES.png,
    description: 'Rasterize a saved diagram HTML into a PNG file in the workspace (next to the HTML by default) by driving the machine\'s installed Chrome/Chromium headlessly at 2× scale. Use it when a PNG file is needed for a document, slide or submission instead of asking the user to click the card button. Requires a Chrome/Chromium install; set CHROME_PATH when it is not in a standard location.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Workspace-relative .html path; defaults to the latest diagram saved in this session.' },
        output: { type: 'string', description: 'Optional workspace-relative .png output path; defaults to diagrams/<name>.png next to the HTML.' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          bytes: { type: 'integer' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          browser: { type: 'string' },
        },
        required: ['path', 'bytes', 'width', 'height'],
      },
      render: (_args: unknown, value: { path: string; bytes: number; width: number; height: number }) => [{
        type: 'text',
        text: `PNG written to ${value.path} (${String(value.width)}×${String(value.height)}, ${String(value.bytes)} bytes).`,
      }],
    },
    execute: async (args: { path?: unknown; output?: unknown }, exec: { agent?: unknown; signal?: unknown }) => {
      const target = await targetDiagram(ctx, exec, args.path)
      const browser = findBrowser()
      if (browser === undefined) {
        throw new Error('no Chrome/Chromium found for host-side PNG export. Install one, set CHROME_PATH, or click PNG on the diagram card (the browser half rasterizes it without this dependency).')
      }
      const output = typeof args.output === 'string' && args.output.trim() !== ''
        ? workspacePath(target.cwd, args.output.trim())
        : join(target.cwd, 'diagrams', `${target.path.split(sep).pop()!.replace(/\.html$/iu, '')}.png`)
      if (!output.toLowerCase().endsWith('.png')) throw new Error('output must end with .png')
      mkdirSync(dirname(output), { recursive: true })
      const rendered = renderPng({ browser, htmlPath: target.path, outPath: output })
      return { path: output, bytes: rendered.bytes, width: rendered.width, height: rendered.height, browser }
    },
  })
}
