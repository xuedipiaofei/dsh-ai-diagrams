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

## 5. 当前阻塞（2026-11-16）

本机凭据状态：

- **npm**：`~/.npmrc` 里的 token 已失效（`npm whoami` → 401 Unauthorized），无法 `npm publish`。
  需要刷新：`npm login`（或到 npmjs.com 生成新 token 写入 `~/.npmrc`）。
- **GitHub**：SSH key 可用（`ssh -T git@github.com` → 已认证为 `xuedipiaofei`），但**没有** API token / `gh` CLI，
  因此不能通过 API 新建仓库、fork 或开 PR。需要二选一：
  1. 在 https://github.com/new 新建空仓库 `xuedipiaofei/dsh-ai-diagrams`（Public，不要 README），
     之后本机执行：
     ```sh
     git remote add origin git@github.com:xuedipiaofei/dsh-ai-diagrams.git
     git push -u origin main
     ```
  2. 提供一个有 `public_repo` 权限的 GitHub token（不要提交到仓库），即可由 agent 自动建仓库、fork、开 PR。

## 6. 凭据就绪后的发布顺序

```sh
# 1) npm
cd /Users/shimin/Documents/deepseek-harness/default-workspace/dsh-ai-diagrams
npm publish --access public

# 2) GitHub
git remote add origin git@github.com:xuedipiaofei/dsh-ai-diagrams.git
git push -u origin main

# 3) awesome PR（仓库满 1 天后开；文件内容见 market/awesome-entry.yml）
#    target: data/plugins/xuedipiaofei__dsh-ai-diagrams.yml

# 4) 官方创意工坊（dsh-market.com，独立投稿）
```
