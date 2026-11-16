# Publishing dsh-ai-diagrams

Status: **built and verified locally (0.1.0)** — not published yet.

## 1. Local verification

```sh
pnpm install
pnpm typecheck        # tsc --noEmit
pnpm test             # 248 tests (incl. 223 vendored skill examples + host wiring)
pnpm build            # lib/index.js + lib/client.js
pnpm pack             # ~1 MB tarball (skills compress well)
```

Local install into the running profile (linked checkout, restarts app):

```sh
dsh plugin --profile desktop add /path/to/dsh-ai-diagrams
```

## 2. npm

```sh
npm publish --access public
```

The package name `dsh-ai-diagrams` was free on 2026-11-15. A GitHub Actions
publish workflow with npm trusted publishing is a follow-up (the drawio-chat
workflow needs a configured trusted publisher or it fails at the publish step).

## 3. Community catalog (awesome-dsh-plugin)

- Entry: [`market/awesome-entry.yml`](market/awesome-entry.yml)
- Target file: `data/plugins/xuedipiaofei__dsh-ai-diagrams.yml`
- PR body: [`market/PR-body.md`](market/PR-body.md)
- Repository age gate: repos must be ≥ 1 day old; open the PR after that.

## 4. Official workshop (dsh-market.com)

The workshop is a separate curated list (plugins manifest, generated daily) and
does not sync the awesome catalog. Submit the same plugin through its PR
process after npm + awesome; keywords: `diagram`, `diagram-design`,
`architecture`, `flowchart`, `svg`, `mermaid`, `drawio`.

## 5. 发布记录（2026-11-16）

- **npm**：`dsh-ai-diagrams@0.1.0` 已发布（npm 首次发布走 staged 处理，约 4 分钟后 `latest` 生效）。
- **GitHub**：https://github.com/xuedipiaofei/dsh-ai-diagrams 已创建（public，SSH push）。
- **awesome-dsh-plugin PR**：[#15783](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/15783)。
  Submission gate 因仓库年龄（0.0 days，需要 1 天）暂时失败；检查会自行重跑，约 24h 后转绿，无需重复提交。
- **官方创意工坊 PR**：[dsh-community-plugins#111](https://github.com/zhu1090093659/dsh-community-plugins/pull/111)，
  已按 `community.json` 的 id 升序单点插入；`pnpm community:check` 等价脚本与单测本地 10/10 通过。

## 6. 0.2.0（P1）

- 新增 `diagram_types`（类型检索）、`diagram_profile`（品牌 profile）、`diagram_png`（主机侧 2× PNG）。
- 右侧栏「AI 图表画廊」页签：搜索、示例预览、复制提示词；`/api/dsh-ai-diagrams/gallery` +
  `/asset` 两个 loopback 路由，示例只允许 skill 自带的 `example-*.html`。
- PlantUML 导入从“识别但不解析”升级为 participant/class 子集解析（方向、别名、关系）。
- 品牌 profile 存到 `$DSH_HOME/editorial-diagrams/profiles`，fetch 拒绝私网/回环目标，页面 1 MB 上限。
- 284 tests / typecheck / build 通过；`0.2.0` 已发布（npm 处理约 2.5 分钟），tag `v0.2.0` + GitHub Release。

## 7. 后续发布（新版本时）

```sh
cd dsh-ai-diagrams
pnpm run typecheck && pnpm run test && pnpm run build
npm publish --access public     # 账号开启 2FA 时会走浏览器授权
git tag v0.1.0 && git push origin v0.1.0
```
