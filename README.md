# AgentLens for Obsidian

Save public social posts, images, videos, and creator content from **TikTok, Instagram, X (Twitter), Facebook, Reddit, Xiaohongshu, and more** directly to your Obsidian vault as Markdown notes, **with the option to download and embed original media files (images and videos)**  -  powered by **[AgentLens API](https://agentlensapi.io)**.

AgentLens for Obsidian uses AgentLens API as its social media content retrieval service. Paste a public social post link or fetch posts from a supported creator profile link, then save the content alongside your research and ideas in Obsidian.

Start with **20 free credits every month** when you register. Ready to make collecting part of your daily routine? Plans start at **just $2.90/month for 300 credits**  -  an average of 10 credits a day for saving useful social posts, collecting inspiration, and building your research library. A small addition to your coffee budget, a month of content collecting. See [Plans and billing](#plans-and-billing) for details.



## Features

- **Powered by AgentLens API:** a unified service for retrieving public social media content across platforms. AgentLens API handles content retrieval; the plugin provides the Obsidian interface and saves notes to your vault.
- **Single post fetch:** retrieve content from a public social post link and save it as an Obsidian note.
- **Profile bulk fetch:** retrieve multiple posts from a supported public creator profile and save selected content to your vault. 
- **Easy-to-find note names:** saved notes follow `platform_creator_date_title-or-first-caption-line.md`, making sources easier to identify in your vault.
- **Source properties and tags:** preserve the platform, creator name and profile link, original source URL, publication and fetch times, and media details as note properties. Platform and creator tags help you search, filter, and organize your collection while keeping every note traceable to its source.

The v0.1.x interface is available in English and supports the light theme. 



## Supported platforms

The platform list below covers 21 platforms for public social content retrieval through **AgentLens API**. 

Single-post and profile bulk support can differ by platform and content type.

| Platform | Platform | Platform |
| --- | --- | --- |
| TikTok | Instagram | X (Twitter) |
| Facebook | Threads | Reddit |
| LinkedIn | Twitch | Pinterest |
| Bluesky | Snapchat | Kick |
| Lemon8 | Douyin (抖音) | Xiaohongshu / RED (小红书) |
| Weibo (微博) | Kuaishou (快手) | Xigua Video (西瓜视频) |
| Zhihu (知乎) | WeChat Official Accounts (微信公众号) | WeChat Channels (微信视频号) |



## Requirements

- **Obsidian 1.11.4 or later on desktop.** This release does not support the Obsidian mobile app.
- An internet connection to sign in, fetch content, and manage subscriptions.
- An AgentLens account for account-based access. Register with your email address or your Google account from the plugin.
- Available credits for the requested operation. Registered users receive 20 free credits per month; paid subscriptions provide additional credits.



## Installation

### From GitHub Releases

Use this method while the plugin is awaiting inclusion in the Obsidian Community plugins directory.

1. Download **`agentlens-social-archiver-0.1.0.zip`** from the [0.1.0 Release](https://github.com/inkad-code/AgentLens-for-Obsidian/releases/tag/0.1.0) and extract it. Use this installation ZIP, not GitHub's automatically generated **Source code (zip)**.
2. Open the Obsidian vault folder where you want to install the plugin.
3. Open the hidden folder `<Vault>/.obsidian/plugins/` and create a folder named `agentlens-social-archiver` inside it.
4. Place `main.js`, `manifest.json`, and `styles.css` directly inside that folder. The final structure must be:

   ```text
   <Vault>/.obsidian/plugins/agentlens-social-archiver/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

   Do not nest an extra ZIP folder inside the plugin folder. The ZIP also includes this README, the LICENSE, and third-party notices. Keep these documents with your copy.

   Alternatively, download `main.js`, `manifest.json`, and `styles.css` separately from the same Release. Obsidian community installation uses these standalone assets.

   `SHA256SUMS` covers the three standalone files and the installation ZIP. On macOS/Linux, run `shasum -a 256 -c SHA256SUMS` with all four files in the same directory to verify their integrity.

5. Restart Obsidian, or run **Reload app without saving** from the command palette after saving your work.
6. Open **Settings → Community plugins** and enable **AgentLens for Obsidian**. If Obsidian displays a community plugin trust prompt, review and confirm it yourself.
7. Click the AgentLens download icon in the left ribbon, or run **AgentLens: Open panel** from the command palette.
8. Click **Log in / Start Free** and sign in to your account, or register with your email address or Google account.



### From Community plugins

Once the plugin is listed in the official directory, open **Settings → Community plugins → Browse**, search for AgentLens, and install and enable it.



## Getting started

### 1. Open AgentLens

Click the AgentLens download icon in Obsidian's left ribbon, or open the command palette and run **AgentLens: Open panel**.

### 2. Sign in

Click **Log in / Start Free** in the plugin. If you are new to AgentLens, register with your email address or choose Google registration. If you already have an account, sign in. Follow the prompts, then check that your account is connected in Obsidian.

### 3. Fetch a single post

Each successful single-post parse costs **1 credit**.

1. Select the **Single post fetch** tab.
2. Paste a public social post link supported by the plugin.
3. Click **Parse** and wait for the result.
4. Review the retrieved content before saving it.
5. Choose the destination folder in your vault. The default is `/AgentLens/Inbox`.
6. Click **Save** to save the content to the selected folder.

Nothing is written to your vault until you click **Save**.

Support can vary by platform and content type. A link must be accessible to the retrieval service; a URL that opens in your signed-in browser may still be unavailable to AgentLens. This release does not promise access to private, login-only, deleted, or otherwise restricted content.

See [Supported platforms](#supported-platforms) for the platform list. 

### 4. Fetch social posts from a creator profile

Bulk fetch retrieves posts one page at a time. The number of posts returned per page depends on the platform. Each successfully parsed page costs **1 credit**.

1. Select the **Creator profile bulk fetch** tab.
2. Paste a supported public creator profile link and click **Parse**.
3. Review the returned posts and select the content you want to save.
4. Choose the destination folder in your vault. The default is `/AgentLens/Inbox`.
5. Click **Save** to import your selection into the selected folder.

Profile bulk fetching is a manual operation. It does not follow the creator or schedule future imports. Profile support may differ from single-post support.



## Saved note structure

### Note names

Saved notes use this naming pattern:

```text
{platform}_{creator}_{date}_{title or first line of caption}.md
```

The platform, creator, and date make the note easy to identify, while the title or first caption line helps you recognize its content.

### Default note properties

Saved notes include the following Obsidian properties:

| Property | What it contains |
| --- | --- |
| `Platform` | The source platform, such as `tiktok`. |
| `Creator_name` | The creator's name. |
| `Creator_url` | A link to the creator's profile. |
| `Source_url` | The original post link. |
| `Published_at` | The source content's publication timestamp. |
| `Fetched_at` | The timestamp when the content was retrieved. |
| `Media_count` | The number of media items associated with the content. |
| `Media_policy` | The media saving policy, such as `download_all`. |
| `tags` | Platform and creator tags, such as `X(twitter)` and `SpaceX`. |

Use these properties and tags to find notes by platform or creator, filter your collection, and reopen the original source.

Before saving, choose how to handle media:

- **Download available:** download available images and videos into your vault and embed the local media files in the Markdown note. Saved notes and successfully downloaded media files remain available offline.
- **Link only:** save media links in the Markdown note without downloading the media files. The note is stored locally, but accessing the linked media requires an internet connection, and the saved media link must still be valid and unexpired.

A remote media link is not a local media file: it requires an internet connection and may expire or stop working if the source changes. If a media file cannot be downloaded, it has not been archived locally. Check the save result and the files in your vault to confirm what was saved.



## Plans and billing

Registered users receive **20 free credits per month** to use with AgentLens API-powered content fetching. Paid subscriptions start at **$2.90 per month**, providing **300 credits per month**.

**A daily collecting habit, for just $2.90 a month.** With an average budget of 10 credits a day over 30 days, you have room to collect useful posts, save creative references, and keep research sources together in Obsidian. Try the free credits first, then upgrade when collecting becomes part of your routine.

### Subscription plans

| Plan | Monthly billing (USD) | Annual billing (USD) | Included credits |
| --- | --- | --- | --- |
| Basic | Free | Free | 20 per month |
| Pro | $2.90/month | $29.90/year | 300 per month |
| Ultra | $6.90/month | $69.90/year | 1,000 per month |
| Mega | $9.90/month | $99.90/year | 2,000 per month |

Annual plans are billed once per year, but credits still refresh **monthly**. Unused subscription credits reset at the start of the next monthly credit period.

### Add-on packs

| Pack | One-time price (USD) | Expiration |
| --- | --- | --- |
| 200 credits | $2.90 | Never expire |
| 600 credits | $6.90 | Never expire |
| 1,200 credits | $9.90 | Never expire |

Subscription credits are used first, followed by add-on credits. Add-on packs provide extra credits for an existing plan. 

Prices checked on October 14, 2026. See the [official AgentLens pricing page](https://agentlensapi.io/pricing) for current prices and plan details.

Single-post fetching costs **1 credit per successful parse**. Profile bulk fetching costs **1 credit per successfully parsed page**, with the number of posts per page depending on the platform.

Failed retrievals do not consume credits. 

Upgrades take effect immediately; downgrades and cancellations take effect at the end of the current subscription term (monthly or annual).



Desktop media downloads stream to temporary files, with a limit of **5 GiB per file**, then copy completed files into the selected vault. Incomplete downloads are not reported as saved. Temporary files are removed after completion or failure. This requires temporary storage outside the vault and sufficient free disk space.

## Network access and privacy

Content fetching requires an internet connection and is provided by **AgentLens API**. The plugin sends retrieval requests to this service and saves the returned content to your Obsidian vault.

| Service | Purpose |
| --- | --- |
| AgentLens / AgentLens API | Account access, plan/access information, and retrieval of the public content you request. |
| Google | Authentication when you choose to register or sign in with Google. |
| Stripe | Subscription checkout and payment processing. |
| Source platforms and media hosts | Access to source content or remote media where required by the retrieval and display workflow. |

Fetching sends the requested source URL to AgentLens. Account-related operations require authentication information.



## Troubleshooting

| Problem | What to try |
| --- | --- |
| Sign-in does not complete | Check your connection and follow the account screen's prompts. If using Google, complete the authentication flow and return to Obsidian. Retry sign-in if the account remains disconnected. |
| A link cannot be fetched | Check that the URL is complete, public, and supported. If the source is unavailable or restricted, try another public link. |
| Access or credits are unavailable | Check your account and plan information in the plugin before submitting another fetch. |
| A note cannot be saved | Check that the vault is writable and that the selected destination is valid. Review the error before retrying. |
| A saved media link no longer works | The source may have changed or the remote URL may have expired. A remote link does not guarantee a permanent local archive. |
| The interface is difficult to read in dark mode | Use Obsidian's light theme; this release supports the light theme only. |

## Support

Report problems through this repository's **Issues** tab. Include the plugin version, Obsidian version, operating system, steps to reproduce, and the error message. Use a public example URL when possible.

Do not include passwords, access tokens, payment information, or private vault content in an issue or screenshot.



## License

Copyright (c) 2026 Wiphox, LLC. Released under the [MIT License](LICENSE).



AgentLens for Obsidian is a third-party plugin and is not an official Obsidian product.
