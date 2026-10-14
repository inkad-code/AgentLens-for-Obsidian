# Community scan follow-up

This document records local verification, not approval by the Obsidian community directory.

- Run `npm run scan:source` for the official `eslint-plugin-obsidianmd` recommended rules. API-version checks remain enabled. The plugin-owned configuration is named `agentlensSettings` to avoid a collision with Obsidian 1.13's `Plugin.settings`; persisted settings keep their existing key.
- Settings expose named render definitions for search on Obsidian 1.13+, with the same controls and persistence callbacks used by the imperative fallback on 1.11.4. Indexing does not perform I/O.
- Desktop streaming uses filesystem APIs for private temporary downloads and validated destinations in the vault. README discloses this. Startup checks prevent eager loading of desktop modules; dynamic imports are compiled to lazy CommonJS loads for Electron renderer compatibility.
- Vault path enumeration supports folder selection and import reconciliation. Folder counts are cached and invalidated on create/delete/rename. Clipboard access is user initiated.
- The build explicitly disables React DOM runtime script creation (inline, external, preinit and module scripts). `scripts/react-no-scripts.mjs` is a readable, version-checked build restriction, not obfuscation. The build fails if upstream implementation changes. `scripts/test-react-no-scripts.mjs` verifies normal rendering and all four blocked paths in a DOM environment.
- The broad pop-out `:has()` selectors were replaced with a scoped class maintained by the existing window observer. Single-fetch help uses an explicit state class. Clip paths were removed; screen-reader-only content uses the conventional clipped rectangle. Grid column-gap/row-gap pairs use equivalent gap shorthand. Remaining scoped `:has()` and `!important` rules require visual compatibility review, not blanket removal.
- The installation ZIP and SHA256SUMS are for manual installation and verification. Obsidian's installer consumes the three standalone runtime files.
- Release assets are built, attested, and retained by GitHub Actions. Publish those exact retained files, not a separate local rebuild.

Validation must cover settings persistence, main and pop-out windows, real media download/save, abort cleanup, and proxy handling. A successful unit test run is not a substitute for installed-host or official review results.
