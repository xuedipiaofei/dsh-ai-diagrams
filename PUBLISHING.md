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
