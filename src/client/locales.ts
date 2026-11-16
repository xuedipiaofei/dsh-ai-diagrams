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
  'gallery.title': 'Diagram types',
  'gallery.guideTitle': 'AI diagrams gallery',
  'gallery.guideDescription': 'Browse the 50 bundled diagram types and copy a prompt.',
  'gallery.search': 'Search types…',
  'gallery.loading': 'Loading types…',
  'gallery.failed': 'Could not load types: {error}',
  'gallery.empty': 'No type matches that search.',
  'gallery.count': '{count} types',
  'gallery.preview': 'Preview',
  'gallery.copy': 'Copy prompt',
  'gallery.copied': 'Prompt copied',
  'gallery.copyFailed': 'Copy failed',
  'gallery.close': 'Close preview',
  'gallery.noExample': 'No example for this type',
  'gallery.prompt': 'Draw a {title} diagram: ',
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
  'gallery.title': '图表类型',
  'gallery.guideTitle': 'AI 图表画廊',
  'gallery.guideDescription': '浏览内置的 50 种图表类型，复制提示词直接用。',
  'gallery.search': '搜索类型…',
  'gallery.loading': '正在加载类型…',
  'gallery.failed': '加载类型失败：{error}',
  'gallery.empty': '没有匹配的类型。',
  'gallery.count': '{count} 种类型',
  'gallery.preview': '预览',
  'gallery.copy': '复制提示词',
  'gallery.copied': '已复制提示词',
  'gallery.copyFailed': '复制失败',
  'gallery.close': '关闭预览',
  'gallery.noExample': '该类型没有示例',
  'gallery.prompt': '用「{title}」类型画一张图：',
}

/** Keys the card can translate. */
export type DiagramKey = keyof typeof en
