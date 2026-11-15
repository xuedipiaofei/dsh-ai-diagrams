# NOTICE

dsh-ai-diagrams (plugin code outside `skills/`) is licensed under the Apache
License, Version 2.0.

## Vendored skill

`skills/diagram-design/` is a vendored copy of the
[diagram-design](https://github.com/cathrynlavery/diagram-design) agent skill by
Cathryn Lavery, licensed under the MIT License. Its copyright and permission
notice are reproduced in `THIRD_PARTY_LICENSES.md`. The only local change is an
appended "DeepSeek Harness tools" section in `SKILL.md`; the vendored commit is
recorded in `.harness/upstream.lock.json`.

## Build configuration

`shared/` (tsdown client-bundle preset, vitest setup, platform module list) and
the TypeScript build configuration were adapted from the dsh-web project and the
sibling `dsh-drawio-chat` plugin, both Apache-2.0. They configure the bundle;
they contain no diagram-design content.

## Trademarks

Product names and logos referenced by the vendored skill's icon set remain the
property of their respective owners and are used for illustration only.
