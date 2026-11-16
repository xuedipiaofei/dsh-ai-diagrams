# AI diagrams · detail

Editorial diagram generation for DeepSeek Harness, built on the MIT-licensed
[`cathrynlavery/diagram-design`](https://github.com/cathrynlavery/diagram-design)
skill.

## What you get

- **A bundled agent skill.** Installing the plugin registers `diagram-design`
  as a session skill. No clone, no skill-root configuration, no Python.
- **Inline results.** `diagram_save` validates the document, saves it under the
  workspace `diagrams/` folder and renders it in the chat: HTML, SVG and PNG
  export buttons, open-in-browser and an expanded preview.
- **Existing diagrams, redrawn.** `diagram_import` reads `.drawio`, Mermaid,
  Excalidraw and PlantUML sources and returns a bounded node/edge digest so the
  model can redraw them in the editorial style.
- **Brand matching.** The skill's onboarding flow can pull a site's palette and
  fonts into a named profile.

## Skills, tools and routes

| Surface | Name | Purpose |
|---|---|---|
| skill | `diagram-design` | The full diagram-design instructions (50 types, references, examples) |
| tool | `diagram_save` | Save + validate + inline preview |
| tool | `diagram_svg` | Standalone SVG export |
| tool | `diagram_validate` | Accessible-SVG / single-file contract check |
| tool | `diagram_import` | Structure digest from existing diagram sources (draw.io / Mermaid / Excalidraw / PlantUML) |
| tool | `diagram_types` | Search the 50 bundled diagram types |
| tool | `diagram_profile` | Fetch/list/get/delete reusable brand profiles |
| tool | `diagram_png` | Rasterize a saved diagram into a workspace PNG |
| route | `/api/dsh-ai-diagrams/raw` | Loopback-only preview of files this plugin saved |
| route | `/api/dsh-ai-diagrams/svg` | Loopback-only SVG export used by the card |
| route | `/api/dsh-ai-diagrams/gallery` | Diagram-type index for the sidebar gallery |
| route | `/api/dsh-ai-diagrams/asset` | Loopback-only preview of a bundled example page |
| sidebar | `diagrams-gallery` | Gallery page in the right Sidebar (guide entry) |

## Limits

- Static documents only: no scripts and no remote assets except Google Fonts.
  Motion variants are not previewed.
- The skill's painted-geometry verifier is not ported to the DSH validator.
- PNG export happens in the browser on the card; the `diagram_png` tool needs a
  locally installed Chrome/Chromium and falls back to the card button when none
  is found. Webfonts fall back to local fonts in rasterized output.
- `diagram_profile fetch` reads public HTML pages only (loopback/private
  targets rejected, 1 MB cap) and stores profiles under `$DSH_HOME/editorial-diagrams/profiles`.

## License

Plugin code is Apache-2.0. The vendored skill and its example assets are MIT
(© Cathryn Lavery); icon sets are attributed in `THIRD_PARTY_LICENSES.md`.
