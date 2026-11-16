import { describe, expect, it } from 'vitest'
import { fileStem } from '../src/client/contract.ts'

describe('fileStem', () => {
  it('trims separators left by non-ASCII titles', () => {
    expect(fileStem('一次 diagram_save 的时序')).toBe('diagram_save')
    expect(fileStem('插件架构：一句话变成一张图')).toBe('diagram')
    expect(fileStem('Login flow!')).toBe('Login-flow')
    expect(fileStem(undefined)).toBe('diagram')
  })
})
