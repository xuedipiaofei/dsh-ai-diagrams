import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findBrowser, pngSize, renderArguments } from '../src/core/png.ts'

/** Minimal PNG prefix: signature + IHDR length/type + width/height. */
function pngHeader(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

describe('png export', () => {
  it('builds a headless 2x screenshot invocation without duplicate flags', () => {
    const args = renderArguments(
      { browser: '/chrome', htmlPath: '/tmp/diagram.html', outPath: '/tmp/diagram.png' },
      '/tmp/profile',
    )
    expect(args[0]).toBe('--headless=new')
    expect(args).toContain('--force-device-scale-factor=2')
    expect(args).toContain('--window-size=1280,900')
    expect(args).toContain('--virtual-time-budget=6000')
    expect(args).toContain('--screenshot=/tmp/diagram.png')
    expect(args).toContain('--user-data-dir=/tmp/profile')
    expect(args.at(-1)).toBe('file:///tmp/diagram.html')
    expect(new Set(args).size).toBe(args.length)
  })

  it('reads width and height from the PNG IHDR chunk', () => {
    expect(pngSize(pngHeader(1600, 1200))).toEqual({ width: 1600, height: 1200 })
    expect(pngSize(Buffer.alloc(4))).toEqual({ width: 0, height: 0 })
  })

  it('honours CHROME_PATH when the executable exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-ai-diagrams-browser-'))
    const executable = join(dir, 'chrome')
    writeFileSync(executable, '')
    expect(findBrowser({ CHROME_PATH: executable } as NodeJS.ProcessEnv)).toBe(executable)
  })

  it('ignores a missing CHROME_PATH and falls back to detection', () => {
    const found = findBrowser({ CHROME_PATH: '/definitely/missing/chrome' } as NodeJS.ProcessEnv)
    // The fallback may legitimately find a browser on this machine; it must never
    // return the missing override.
    expect(found).not.toBe('/definitely/missing/chrome')
  })
})
