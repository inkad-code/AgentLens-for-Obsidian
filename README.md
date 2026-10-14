# AgentLens for Obsidian

Save supported public social posts as organized Markdown notes with links back to their sources.

## Version 0.1.0

This release provides **Single Fetch** and **Bulk Fetch** for manually retrieving public posts and creator feeds, previewing results, and saving selected content and supported attachments to your vault. Auto Fetch and Activity are not available in this release. The interface is in English.

Requires Obsidian **1.11.4 or newer**. Mobile compatibility is checked by the build; this release has not been validated on every mobile device or operating system.

## Getting started

1. Install and enable AgentLens, then open its panel from the ribbon or the command palette.
2. Try the prefilled public demo links, or sign in to an AgentLens account to retrieve your own supported links.
3. Choose Single Fetch for one post or Bulk Fetch for a creator feed. Paste a supported public URL and retrieve the preview.
4. Select the content to save and choose a destination in your vault. Saved Markdown includes source links; media availability depends on the source platform.

For manual installation, download `main.js`, `manifest.json`, and `styles.css` from the same GitHub release, put them in `<Vault>/.obsidian/plugins/agentlens-social-archiver/`, reload Obsidian, and enable the plugin in Community plugins.

## Account, payment, and network requirements

An **AgentLens account and internet connection are required for normal retrieval**. A limited anonymous demo is available for the prefilled links; it retrieves cached public examples from AgentLens. Bulk demo saving prompts you to register.

AgentLens is a credit-based service. Availability and quotas depend on your account and plan; paid plans or credit purchases may be required for additional access. The plugin displays account and plan information. Review the current plan and price before buying. Payments use Stripe checkout in your browser.

The plugin contacts `https://agentlensapi.io/api/` for authentication, platform capabilities, public-content retrieval, quota/billing operations, and write receipts. Google sign-in opens your browser. Attachments are downloaded from media URLs returned by AgentLens, which may be hosted by the original platform or its CDN. Fetching content and media therefore shares network requests with those services.

## Privacy and vault access

Requests may include the submitted public URL, pagination cursor, installation/device identifiers, plugin version, and request identifiers. Write receipts include a stable content key, outcome, and vault-relative note path. They do not include the absolute vault path or unrelated note content.

The plugin does not scan or upload your vault. It reads an existing target note when comparing or updating a previously saved item. Refresh tokens use Obsidian SecretStorage; local plugin settings hold the secret reference and operational state. Diagnostic export is an explicit user action.

Updates preserve user text outside the AgentLens-managed Markdown block and unrelated frontmatter. Unmarked files at the target path block replacement. A failed attachment download can leave a saved note with an incomplete-media result; it does not mean every attachment was saved.

See the [Privacy Policy](https://agentlensapi.io/privacy) and [Terms of Service](https://agentlensapi.io/terms). The service processes operational records for authentication, usage, billing, and request troubleshooting.

## Source and license

The plugin source and release assets are published together in this repository under the [MIT License](LICENSE).

This plugin bundles React, React DOM, and Scheduler; their licenses are included in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). AgentLens is an independent plugin and is not an official Obsidian product.

## Support

Report reproducible issues in [GitHub Issues](https://github.com/inkad-code/AgentLens-for-Obsidian/issues). Include your Obsidian and plugin versions and steps to reproduce; do not post passwords, tokens, private notes, or payment details.

## Reproducible review build

Use Node.js 22 and `npm ci`, then `npm run build` to build the production Single/Bulk review profile. Run `npm run package:review` for lint, type checking, tests, production package validation, and ZIP creation. The full development profile is available explicitly as `npm run build:full`.

### Optional remote development target

The public repository contains only production and loopback API targets. To use your own HTTPS development service, set `AGENTLENS_DEV_API_BASE_URL` in your shell, then run `npm run build:development` and `npm run package:verify:development` in that same environment. The setting cannot override the production target. Do not put credentials in the URL or commit private environment configuration. `npm run test:host:install:development` explicitly opts in to installing that development build in the isolated test vault.

Billing artwork is already embedded in the source; building does not require access to a design service or export-time asset links.
