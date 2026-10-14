# Community scan follow-up

This document records local verification, not approval by the Obsidian community directory.

- Run `npm run scan:source` for the official `eslint-plugin-obsidianmd` recommended rules. API-version checks remain enabled. The plugin-owned configuration is named `agentlensSettings` to avoid a collision with Obsidian 1.13's `Plugin.settings`; persisted settings keep their existing key.
- One advisory remains: declarative settings search is optional on Obsidian 1.13+. The imperative settings page is retained for the declared 1.11.4 baseline.
- Desktop streaming uses filesystem APIs for private temporary downloads and validated destinations in the vault. README discloses this. Startup checks prevent eager loading of desktop modules; dynamic imports are compiled to lazy CommonJS loads for Electron renderer compatibility.
- Vault path enumeration supports folder selection and import reconciliation. Folder counts are cached and invalidated on create/delete/rename. Clipboard access is user initiated.
- `createElement("script")` strings in the bundle originate from React DOM 19.2.8's resource handling code (`react-dom-client.production.js`). Business source does not create script elements or invoke React `preinit`. Provider HTML is parsed as inert content and script elements are discarded. These dependency strings are not removed or obfuscated. This attribution requires reviewer evaluation; it is not an assertion that an external scan will report zero errors.
- The broad pop-out `:has()` selectors were replaced with a scoped class maintained by the existing window observer. Remaining scoped `:has()`, `!important`, clip paths, and multicolumn styles require visual compatibility review, not blanket removal.
- The installation ZIP and SHA256SUMS are for manual installation and verification. Obsidian's installer consumes the three standalone runtime files.
- Release assets are built, attested, and retained by GitHub Actions. Publish those exact retained files, not a separate local rebuild.

Validation must cover settings persistence, main and pop-out windows, real media download/save, abort cleanup, and proxy handling. A successful unit test run is not a substitute for installed-host or official review results.
