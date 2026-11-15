/**
 * Card copy for the ai-diagrams tool view. Kept beside the card instead of a
 * locale JSON so the dictionary is type-checked with the keys it serves; the
 * plugin's locale/ JSON carries the plugin-manager metadata.
 */

/** English strings. */
export const en = {
  'ai.title': 'Diagram',
  'ai.loading': 'Rendering…',
  'ai.renderFailed': 'Preview failed: {error}',
  'ai.exportFailed': 'Export failed: {error}',
  'ai.downloadHtml': 'HTML',
  'ai.exportSvg': 'SVG',
  'ai.exportPng': 'PNG',
  'ai.open': 'Open',
  'ai.expand': 'Expand',
  'ai.collapse': 'Collapse',
  'ai.path': 'path',
} as const

/** Chinese strings. */
export const zh: Record<keyof typeof en, string> = {
  'ai.title': '图表',
  'ai.loading': '正在渲染…',
  'ai.renderFailed': '预览加载失败：{error}',
  'ai.exportFailed': '导出失败：{error}',
  'ai.downloadHtml': 'HTML',
  'ai.exportSvg': 'SVG',
  'ai.exportPng': 'PNG',
  'ai.open': '打开',
  'ai.expand': '放大',
  'ai.collapse': '收起',
  'ai.path': '路径',
}

/** Keys the card can translate. */
export type DiagramKey = keyof typeof en
