/**
 * Host half of the dsh-ai-diagrams plugin.
 *
 * One bundled skill + four tools:
 * - the `diagram-design` agent skill (full upstream skill, registered through
 *   `ctx.skills.registerProvider` so the model can load it like any local skill);
 * - `diagram_save`      validate + save a generated HTML diagram, render it inline;
 * - `diagram_svg`       export the diagram SVG from a saved HTML file;
 * - `diagram_validate`  check a diagram HTML against the accessible/safety contract;
 * - `diagram_import`    extract a structural digest from draw.io / Mermaid /
 *                       Excalidraw sources so the model can redraw them.
 *
 * The plugin never runs the skill's Python helpers: the parts DSH needs (verify,
 * SVG export, source extraction, PNG via the browser) are TypeScript here.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { importDiagram, renderDigest } from './core/import.ts'
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
} as const

/** Tool names shared with the browser half. */
export const TOOL_NAMES = {
  save: 'diagram_save',
  svg: 'diagram_svg',
  validate: 'diagram_validate',
  import: 'diagram_import',
} as const

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
}
