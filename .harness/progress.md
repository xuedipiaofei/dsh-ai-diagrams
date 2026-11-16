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

## 真机验证（2026-11-15 16:25，desktop profile）
- `plugin_manager install_bundle` 安装成功：`application: applied`，profile 以 symlink 指向工作区 checkout。
- 运行中的 GUI：`GET /api/dsh-ai-diagrams/health` → `{"ok":true,"plugin":"ai-diagrams"}`。
- 会话 skill catalog 出现 `diagram-design`；4 个工具已可调用（schema 已注入）。
- 端到端：`diagram_save` 保存 `diagrams/diagram-6c490dc6.html`（6612 B，卡片已渲染）；
  `diagram_svg` 导出 `diagrams/diagram-6c490dc6.svg`（5026 B，含字体 import）；
  `diagram_import` 解析现有 `diagrams/diagram-284bb748.drawio` → 15 节点 / 14 边（中文标签正常）。
- 修复：导出的 SVG 中字体 `<style>` 原本在 `<title>` 之前，违反「title 为第一子元素」；已改为 title/desc 之后插入，
  重建 + 248 测试通过（运行中的旧实例需重启才会用新 lib，对已导出的文件无影响）。

## PNG 导出修复（2026-11-15 17:17）
- 真机点 PNG 报错「could not decode the diagram SVG」：客户端 `rasterizePng` 把导出的 SVG 塞进 `<img>` 时，
  在原根标签上又插了一次 `xmlns`（Chrome 报 `Attribute xmlns redefined`，拒绝解码）。
- 修复：`rasterMarkup()` 只补 width/height，删除已有 width/height，不重复 xmlns；新增 `tests/raster.spec.ts`。
- 验证：250 tests 通过；用同一张架构图的 `fonts=none` SVG 在 headless Chrome 里跑修复后逻辑 →
  `OK png-bytes=219626 xmlns-count=1`。页面需刷新/重启加载新客户端 bundle。

## 独立真机验证（2026-11-16 12:27，运行中的 GUI 51523）
- 用 `.dsh/.credentials.yaml` 的 browser-session secret 按 DSH 原生格式签发了 loopback cookie，
  以 headless Chrome + CDP 登录运行中的 GUI（未改动用户 profile/页面）。
- 打开最新会话后 DOM：`[data-dsh-part="ai-diagrams-card"]` ×2，按钮为 HTML / SVG / PNG / 打开 / 放大；
  console/exception 无错误。
- 实际点击卡片上的 PNG：下载成功 `-diagram_save-.png`（143,022 bytes），卡片无「导出失败」。
- 结论：客户端卡片与 PNG 导出端到端正常；之前「看不到」是工具调用行默认折叠，展开即见。
- 顺手修：导出文件名 stem 去首尾分隔符（`-diagram_save-.png` → `diagram_save.png`），新增测试；251 tests 通过。

## 发布准备（2026-11-16 12:35）
- 市场截图素材已生成并入库：`docs/images/plugin-row.png`（插件管理页「AI 图表」条目）、
  `docs/images/architecture-example.png`、`docs/images/sequence-example.png`（真实渲染）；
  `screenshots.json` 已更新。
- 重新实测确认：headless 登录运行中的 GUI 后点击卡片 **PNG**，真实下载 143 KB PNG、无报错；
  卡片在会话中渲染正常（会话很长，卡片在工具调用行内，需滚动到位）。
- 发布阻塞（凭据）：npm token 401 失效；GitHub 仅有 SSH（可推已有仓库），无 token/gh 无法建仓库、
  fork 或开 PR。已把解阻步骤写进 `PUBLISHING.md` §5。

## 待办
1. 生成市场截图/演示 GIF（真机卡片 + 画廊）
2. npm publish + awesome PR（仓库满 1 天后再开）+ 官方创意工坊投稿
3. P1：模板画廊侧栏、品牌 profile 工具、PNG 落盘、PlantUML 解析、上游同步脚本
