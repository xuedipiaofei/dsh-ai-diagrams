import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { buildTypeIndex } from '../src/core/gallery.ts'

const SKILL = resolve(process.cwd(), 'skills', 'diagram-design')

describe('buildTypeIndex', () => {
  it('lists all 50 bundled types with titles and unique slugs', () => {
    const types = buildTypeIndex(SKILL)
    expect(types).toHaveLength(50)
    expect(new Set(types.map(type => type.slug)).size).toBe(50)
    for (const type of types) {
      expect(type.title.trim()).not.toBe('')
      expect(type.slug).toMatch(/^[a-z0-9-]+$/u)
    }
    const chart = types.find(type => type.slug === 'flowchart')
    expect(chart?.title.toLowerCase()).toContain('flow')
    expect(types.some(type => type.example !== undefined)).toBe(true)
  })

  it('sorts by title and keeps examples only when the asset exists', () => {
    const types = buildTypeIndex(SKILL)
    for (let index = 1; index < types.length; index += 1) {
      expect(types[index - 1].title.localeCompare(types[index].title, 'en')).toBeLessThanOrEqual(0)
    }
    for (const type of types) {
      if (type.example !== undefined) expect(type.example).toMatch(/^example-[a-z0-9-]+\.html$/u)
    }
  })

  it('returns an empty list when the skill directory is missing', () => {
    expect(buildTypeIndex('/definitely/not/a/skill')).toEqual([])
  })
})
