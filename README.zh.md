# AI 图表 · dsh-ai-diagrams

**DeepSeek Harness 里的编辑设计风图表。** 用一句话描述需求，模型画出一个自包含的 HTML（内联 SVG）并在对话里直接预览；可导出 HTML / SVG / PNG。50 种图表类型，能重画现有的 draw.io / Mermaid / Excalidraw / PlantUML 图，也能按你的网站品牌配色。

基于 MIT 协议的 [`cathrynlavery/diagram-design`](https://github.com/cathrynlavery/diagram-design) skill（© Cathryn Lavery），除「DeepSeek Harness 工具」一节外原样内置。

## 安装

```sh
dsh plugin add dsh-ai-diagrams
```

或在插件市场里安装 / 从本地目录安装。

## 使用

直接说要画什么，然后发布：

> 给这个应用的架构画一张图：前端、后端、数据库、Redis 缓存。

> 我需要一张象限图，按「影响力 × 投入」排 Q2 的项目。

模型会加载 `diagram-design` skill、写出 HTML，并调用 `diagram_save`。图表直接出现在对话里，卡片上有 **HTML / SVG / PNG / 打开** 按钮和放大预览；继续提修改，模型会重画。

重画已有的图：

> 把 platform.drawio 重画一下，放我 deck 里。

模型会调用 `diagram_import` 拿到结构摘要，选对应类型，再保存成编辑风版本。

一次性匹配品牌：

> 按 https://example.com 的品牌色和字体生成后面的图。

## 工具

| 工具 | 作用 |
|---|---|
| `diagram_save` | 校验并保存图表 HTML 到 `diagrams/`，在聊天里渲染卡片 |
| `diagram_svg` | 在 HTML 旁导出只含图表的 `.svg` |
| `diagram_validate` | 检查可访问 SVG / 单文件安全契约，返回具体错误 |
| `diagram_import` | 从 draw.io / Mermaid / Excalidraw / PlantUML 提取结构摘要 |

## 依赖与限制

- **不需要 Python、不需要 Playwright**：校验、SVG 导出、源文件解析和 PNG 光栅化都是 TypeScript / 浏览器代码。
- 保存的图表是静态文档：不能有 `<script>`，除许可的 Google Fonts 样式表外不能有远程资源；motion 变体暂不在 DSH 里预览。
- PNG 由浏览器以 2× 光栅化；Web 字体在 PNG 里会回退成本地字体。
- skill 自带的深度几何检查（`verify_geometry.py`）未移植；DSH 校验覆盖可访问 SVG 契约与单文件安全。

## 许可

插件代码 Apache-2.0；内置的 `skills/diagram-design/` 为 MIT（© Cathryn Lavery），见 [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md)。
