import { describe, expect, it } from 'vitest'
import { rasterMarkup } from '../src/client/useDiagramExport.ts'

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="t d"><title id="t">x</title></svg>`

describe('rasterMarkup', () => {
  it('does not duplicate the xmlns attribute (Chrome rejects a redefined xmlns)', () => {
    const markup = rasterMarkup(SVG, { width: 400, height: 200 })
    expect(markup.match(/xmlns=/gu)).toHaveLength(1)
    expect(markup).not.toContain('<?xml')
    expect(markup).toContain('<svg width="400" height="200"')
  })

  it('replaces an existing width/height instead of stacking them', () => {
    const markup = rasterMarkup(SVG.replace('<svg ', '<svg width="10" height="10" '), { width: 400, height: 200 })
    expect(markup.match(/\swidth=/gu)).toHaveLength(1)
    expect(markup.match(/\sheight=/gu)).toHaveLength(1)
    expect(markup).toContain('width="400"')
  })
})
