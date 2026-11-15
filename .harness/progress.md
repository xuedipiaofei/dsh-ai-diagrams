# dsh-ai-diagrams · 进展

## 目标
把 `cathrynlavery/diagram-design`（MIT，67k stars）做成 DSH 原生插件：安装即注册 `diagram-design` skill，
模型产出单文件 HTML 图后对话内联预览、可导出 SVG/PNG；可重画 draw.io / Mermaid / Excalidraw；
**不依赖 Python/Playwright**；上架 npm / awesome / 官方创意工坊。

## 当前状态（2026-11-15 11:06）
- **0.1.0 MVP 已构建并通过本地验证**：`pnpm typecheck` / `pnpm test`（248 passed）/ `pnpm build` / `pnpm pack`（约 1 MB，341 files）。
- 上游 skill 已 vendor：`skills/diagram-design/`（317 files，commit f6db0de / v2.6.164，见 `.harness/upstream.lock.json`），
  仅追加了「DeepSeek Harness tools」一节。
- Host：`ctx.skills.registerProvider` 注册内置 skill（rank 600，resourceBase=skill 目录）；
  工具 `diagram_save` / `diagram_svg` / `diagram_validate` / `diagram_import`；
  loopback 预览路由 `/api/dsh-ai-diagrams/{raw,svg}`（只服务本进程保存过的文件）。
- Client：`diagram_save` 卡片（sandboxed iframe 预览 + HTML/SVG/PNG 下载 + 打开 + 放大）。
- 校验器已用上游全部 223 个静态示例做真数据回归（全部通过）。
- 市场材料：`market/awesome-entry.yml`、`market/PR-body.md`、`PUBLISHING.md` 已起草。

## 关键决策
- npm 名 `dsh-ai-diagrams`；会话内 skill 名 `diagram-design`；工具名避开 Shang-ZZ 竞品。
- 无 Python：SVG 提取、自检、解析器均为 TS；PNG 由浏览器 canvas 2× 光栅化。
- 静态契约：保存的 HTML 不允许 `<script>`，远程资源仅允许 Google Fonts；motion 变体暂不支持预览。

## 待办
1. 真机安装验证（需用户同意装进 desktop profile）：`dsh plugin --profile desktop add /path/to/dsh-ai-diagrams`
2. 生成市场截图/演示 GIF（真机卡片 + 画廊）
3. npm publish + awesome PR（仓库满 1 天后再开）+ 官方创意工坊投稿
4. P1：模板画廊侧栏、品牌 profile 工具、PNG 落盘、PlantUML 解析、上游同步脚本
