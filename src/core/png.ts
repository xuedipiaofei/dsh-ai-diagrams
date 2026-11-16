/**
 * Host-side PNG export for a saved diagram HTML.
 *
 * DSH's browser half already rasterizes the diagram on the card (SVG → canvas),
 * but a tool that writes a PNG file needs a renderer on the host. Rather than
 * adding a native rasterizer/dependency, this module drives an installed
 * Chromium-family browser headlessly. When no browser is found the tool fails
 * with an actionable message instead of silently producing a broken file.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Result of one rasterization. */
export interface PngResult {
  /** PNG bytes on disk. */
  bytes: number
  /** Pixel width parsed from the PNG IHDR chunk. */
  width: number
  /** Pixel height parsed from the PNG IHDR chunk. */
  height: number
}

/** Candidate browser executables by platform. */
const MAC_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
]

const UNIX_COMMANDS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']

/** Resolve one command from PATH (a cheap `which`). */
function commandOnPath(command: string): string | undefined {
  try {
    const output = execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return output === '' ? undefined : output.split(/\r?\n/u)[0]
  } catch {
    return undefined
  }
}

/**
 * Find a Chromium-family browser on this machine.
 * @param env - environment override (mainly for tests); defaults to process.env.
 * @returns absolute executable path, or undefined.
 */
export function findBrowser(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const configured = env.CHROME_PATH ?? env.CHROMIUM_PATH
  if (configured !== undefined && configured.trim() !== '' && existsSync(configured)) return configured

  if (process.platform === 'darwin') {
    for (const candidate of MAC_CANDIDATES) {
      if (existsSync(candidate)) return candidate
    }
  }
  if (process.platform === 'win32') {
    const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']].filter(Boolean) as string[]
    for (const root of roots) {
      for (const suffix of [
        'Google/Chrome/Application/chrome.exe',
        'Chromium/Application/chrome.exe',
        'Microsoft/Edge/Application/msedge.exe',
      ]) {
        const candidate = join(root, suffix)
        if (existsSync(candidate)) return candidate
      }
    }
  }
  for (const command of UNIX_COMMANDS) {
    const found = commandOnPath(command)
    if (found !== undefined) return found
  }
  return undefined
}

/** Parse width/height from a PNG IHDR chunk. */
export function pngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 24 || bytes.toString('ascii', 12, 16) !== 'IHDR') return { width: 0, height: 0 }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/** One browser invocation; exported for tests. */
export interface RenderOptions {
  /** Browser executable. */
  browser: string
  /** Absolute HTML path. */
  htmlPath: string
  /** Absolute PNG path. */
  outPath: string
  /** Window size; defaults to 1280×900. */
  windowSize?: string
  /** Virtual time budget in ms; defaults to 6000. */
  budgetMs?: number
}

/** Build the command arguments for one render (exported for tests). */
export function renderArguments(options: RenderOptions, profileDir: string): string[] {
  return [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',
    `--user-data-dir=${profileDir}`,
    `--window-size=${options.windowSize ?? '1280,900'}`,
    `--virtual-time-budget=${String(options.budgetMs ?? 6000)}`,
    `--screenshot=${options.outPath}`,
    `file://${options.htmlPath}`,
  ]
}

/**
 * Render one saved diagram HTML to PNG with a headless browser.
 * @param options - browser, input and output paths.
 * @returns PNG metadata.
 */
export function renderPng(options: RenderOptions): PngResult {
  const profileDir = mkdtempSync(join(tmpdir(), 'dsh-ai-diagrams-'))
  try {
    execFileSync(options.browser, renderArguments(options, profileDir), {
      timeout: 60_000,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    if (!existsSync(options.outPath)) throw new Error('the browser did not write a PNG file')
    const buffer = readFileSync(options.outPath)
    const { width, height } = pngSize(buffer)
    return { bytes: statSync(options.outPath).size, width, height }
  } finally {
    rmSync(profileDir, { recursive: true, force: true })
  }
}
