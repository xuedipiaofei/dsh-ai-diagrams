## Add xuedipiaofei/dsh-ai-diagrams

`dsh-ai-diagrams` brings the [diagram-design](https://github.com/cathrynlavery/diagram-design)
skill (MIT, © Cathryn Lavery) to DeepSeek Harness as a plugin:

- **One-click install, no Python.** The plugin bundles the full skill (50
  diagram types, references and examples) and registers it through the DSH skill
  registry; validation, SVG export, source parsing and PNG rasterization are
  TypeScript/browser code, so no `python3` or Playwright is needed.
- **Inline results.** `diagram_save` validates the generated HTML document,
  stores it under `diagrams/` and renders it in the chat with HTML / SVG / PNG
  export, open-in-browser and an expanded preview.
- **Redraw existing diagrams.** `diagram_import` extracts a bounded structure
  digest from `.drawio`, Mermaid, Excalidraw and PlantUML sources.
- **Brand matching.** The skill's onboarding flow can pull a website's palette
  and fonts into a named profile.

- Entry file: `data/plugins/xuedipiaofei__dsh-ai-diagrams.yml`
- Category: `tools`
- Upstream: https://github.com/xuedipiaofei/dsh-ai-diagrams
