# AgentLens Social Importer

[Install from Obsidian Community plugins](https://community.obsidian.md/plugins/agentlens-social-importer) · [Quick start](#quick-start) · [Plans and billing](#plans-and-billing) · [中文](#中文)

**Turn social posts into research notes you can keep, organize, and revisit in Obsidian.**

Save public content from **TikTok, Instagram, X (Twitter), Facebook, Reddit, Xiaohongshu, and more** as Markdown notes with source links, creator details, and tags. Download available images and videos into your vault, or keep media as links.

Collect references for your next project, keep useful posts alongside your own thinking, and return to the original source when you need context.

An AgentLens account and internet connection are required to fetch content through [AgentLens API](https://agentlensapi.io). Start with **20 free credits per month**; paid plans start at **$2.90/month for 300 credits**.



## Why use AgentLens in Obsidian?

- **Keep the source with your notes.** Save post content with the original URL, creator profile, publication time, and fetch time so you can revisit and cite it.
- **Save media locally when available.** Download and embed images and videos for offline access, or choose links to save disk space.
- **Choose what enters your vault.** Preview a single post or select posts from a supported creator profile, choose a folder, then click **Save**.
- **Organize with native Obsidian properties.** Platform and creator tags, source properties, and descriptive filenames help you find references in your existing vault.

The current release covers **manual Single Fetch workflows: single posts and creator profile bulk fetch**. Auto Fetch and scheduled creator monitoring are not included. The interface is available in English and supports the light theme.



## Supported platforms

AgentLens API provides public-content retrieval across the following 21 platforms.

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

### From Community plugins (recommended)

1. Open **Settings → Community plugins → Browse** in Obsidian.
2. Search for **AgentLens Social Importer**.
3. Click **Install**, then **Enable**.

You can also open the [official plugin listing](https://community.obsidian.md/plugins/agentlens-social-importer) and select **Add to Obsidian**.

### From GitHub Releases

Use manual installation for testing or troubleshooting.

1. Download the plugin installation ZIP from this repository's **Releases** page and extract it. GitHub's automatically generated **Source code** ZIP is not an installation package.
2. Open the Obsidian vault folder where you want to install the plugin.
3. Open the hidden folder `<Vault>/.obsidian/plugins/` and create a folder named `agentlens-social-importer` inside it.
4. Place `main.js`, `manifest.json`, and `styles.css` directly inside that folder. The final structure must be:

   ```text
   <Vault>/.obsidian/plugins/agentlens-social-importer/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

   Do not nest an extra ZIP folder inside the plugin folder.

5. Restart Obsidian, or run **Reload app without saving** from the command palette after saving your work.
6. Open **Settings → Community plugins** and enable **AgentLens Social Importer**. If Obsidian displays a community plugin trust prompt, review and confirm it yourself.
7. Click the AgentLens download icon in the left ribbon, or run **AgentLens: Open panel** from the command palette.
8. Click **Log in / Start Free** and sign in to your account, or register with your email address or Google account.



## Quick start

### 1. Open AgentLens Social Importer

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

### Restore a previous fetch list

Use the original request ID to reopen a previously fetched list. Restoring a list does not fetch additional pages or fill in missing post details. In a new fetch, the plugin can request missing details for eligible posts when you preview or save them.



## Saved note structure

Each import becomes a Markdown note in the folder you choose. Source properties preserve its context; downloaded media is embedded from local files. You can then work with the note alongside the rest of your Obsidian research.

### Example properties

The following is an illustrative frontmatter example using fictional content. Available values depend on the source; note text and attachment layout may vary.

```yaml
---
Platform: instagram
Creator_name: Example Creator
Creator_url: https://www.instagram.com/example/
Source_url: https://www.instagram.com/p/example/
Published_at: "2026-10-01T10:00:00Z"
Fetched_at: "2026-10-02T09:00:00Z"
Media_count: 2
Media_policy: download_all
tags:
  - instagram
  - ExampleCreator
---
```

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

### Choose a plan in Obsidian

In AgentLens Social Importer, you can view subscription plans, choose a plan and billing cycle, and start checkout. Complete payment on the checkout page that opens.

**Alipay and WeChat Pay** are available only for supported plans and billing cycles. These are one-time payments for the selected term and **do not renew automatically**.

Registered users receive **20 free credits per month** to use with AgentLens API-powered content fetching. Paid subscriptions start at **$2.90 per month**, providing **300 credits per month**.

The plugin is open source under the MIT License. Content retrieval is provided by AgentLens API and uses account credits. You can try the monthly free allowance before choosing a paid plan.

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



## Local files and clipboard access

Desktop media downloads stream to a plugin-created folder in the operating system's temporary directory, outside the vault, with a **5 GiB limit per file**. Completed downloads are copied into the destination vault. Incomplete downloads are not reported as saved. Temporary files are removed after completion or handled failures; an application crash may leave temporary files until the operating system cleans them up. Allow sufficient free space on both the temporary and vault disks.

The plugin lists vault paths to show destination folders and file counts, and checks notes in the selected folder for earlier imports. These operations do not upload vault contents. Clipboard reading occurs when you invoke **Fetch from clipboard**; **Copy diagnostics** writes a privacy-safe summary when requested.

## Network access and privacy

Content fetching requires an internet connection and is provided by **AgentLens API**. The plugin sends retrieval requests to this service and saves the returned content to your Obsidian vault.

| Service | Purpose |
| --- | --- |
| AgentLens / AgentLens API | Account access, plan/access information, and retrieval of the public content you request. |
| Google | Authentication when you choose to register or sign in with Google. |
| Stripe | Subscription checkout and payment processing. |
| Source platforms and media hosts | Access to source content or remote media where required by the retrieval and display workflow. |

Fetching sends the requested source URL to AgentLens. Account-related operations require authentication information.

When you save notes with media downloads enabled, the save screen shows the number of completed downloads and the actual amount transferred. When the total file size is available, it also shows the total size and percentage. The plugin can download more media files in parallel during a save. If a media request is denied, the plugin may request a download recovery policy from AgentLens API, including for eligible TikTok videos.

## Frequently asked questions

**Can I read saved content offline?**

Saved Markdown notes and successfully downloaded attachments remain in your vault for offline access. Media saved with **Link only** still requires a working remote URL and internet connection.

**Does profile bulk fetch keep checking a creator for new posts?**

No. It imports posts you manually retrieve and select. Auto Fetch and scheduled monitoring are not included in this release.

**Can I import private posts or anything visible in my browser?**

The requested link must be accessible to AgentLens API. Being able to open it in your signed-in browser does not guarantee that the retrieval service can access it.

**Can I use it on mobile or in dark mode?**

This release supports desktop Obsidian 1.11.4 or later, with an English interface and light theme. Mobile and dark-theme support are not included.



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



AgentLens Social Importer is a third-party plugin and is not an official Obsidian product.

---

## 中文

[返回英文](#agentlens-social-importer) · [安装](#安装) · [快速上手](#快速上手) · [套餐与支付](#套餐与支付)

**把社交帖子变成可在 Obsidian 中保存、整理和回看的研究笔记。**

将 **TikTok、Instagram、X（Twitter）、Facebook、Reddit、小红书等平台**的公开内容保存为 Markdown 笔记，保留原帖链接、创作者信息和标签。可将可用的图片和视频下载到 Vault，也可以只保留媒体链接。

为下一个项目收集参考资料，把有用的帖子和自己的思考放在一起，需要核对上下文时再回到原帖。

通过 [AgentLens API](https://agentlensapi.io) 获取内容需要 AgentLens 账号和网络连接。注册后每月有 **20 免费额度（credits）**；付费套餐最低 **每月 2.90 美元，含 300 credits**。

### 为什么在 Obsidian 中使用 AgentLens？

- **笔记保留来源。** 保存原帖链接、创作者主页、发布时间和获取时间，方便回看和引用。
- **按需保存媒体。** 下载并嵌入可用的图片和视频，方便离线查看；也可以只保留链接，节省磁盘空间。
- **自己决定写入什么。** 先预览单帖，或从受支持的创作者主页中勾选帖子，再选择目标文件夹并点击 **Save**。
- **用 Obsidian 原生属性整理。** 平台和创作者标签、来源属性和易辨认的文件名，让你更容易在现有 Vault 中找到参考资料。

当前版本仅包含手动获取：单帖获取和创作者主页批量获取。不包含 Auto Fetch 或定时监控。插件界面为英文，支持浅色主题。

### 安装

需要桌面版 Obsidian **1.11.4 或更高版本**，暂不支持移动端。在 **设置 → 第三方插件 → 浏览** 中搜索 **AgentLens Social Importer**，安装并启用；也可从[官方插件页面](https://community.obsidian.md/plugins/agentlens-social-importer)打开 Obsidian。

如需手动安装，从 GitHub **Releases** 下载插件安装 ZIP（不是 GitHub 自动生成的源码 ZIP）。解压后将 `main.js`、`manifest.json` 和 `styles.css` 直接放入 `<Vault>/.obsidian/plugins/agentlens-social-importer/`，不要再套一层文件夹。保存工作后重启 Obsidian，再到第三方插件设置中启用。

### 快速上手

1. 点击左侧 AgentLens 图标，或运行命令 **AgentLens: Open panel**。
2. 点击 **Log in / Start Free**，使用邮箱或 Google 账号注册或登录。登录、获取内容和管理订阅需要联网。
3. 获取单帖：选择 **Single post fetch**，粘贴支持的公开帖子链接，点击 **Parse** 并预览结果。每次成功解析消耗 **1 credit**。
4. 批量获取：选择 **Creator profile bulk fetch**，粘贴支持的公开创作者主页链接，点击 **Parse**，再勾选要保存的帖子。每成功解析一页消耗 **1 credit**，每页帖子数因平台而异。
5. 选择目标文件夹（默认 `/AgentLens/Inbox`）和媒体保存方式，再点击 **Save**。点击前不会向 Vault 写入内容。

查看[支持的平台](#supported-platforms)。单帖和主页批量获取的支持范围可能不同，也取决于内容类型。你在已登录的浏览器中能打开链接，并不代表 AgentLens API 能获取它；插件不保证能获取私密、仅登录可见、已删除或其他受限内容。

可用原始请求 ID 恢复已获取的列表。恢复时不会继续翻页，也不会补齐缺失的帖子详情。新获取的结果中，符合条件的帖子可在预览或保存时补充详情。

### 笔记与媒体

笔记命名格式为 `{platform}_{creator}_{date}_{title or first line of caption}.md`。属性包括 `Platform`、`Creator_name`、`Creator_url`、`Source_url`、`Published_at`、`Fetched_at`、`Media_count`、`Media_policy` 和 `tags`。可参考[英文属性示例](#example-properties)。

- **Download available**：下载可用的图片和视频，并在笔记中嵌入本地文件。笔记和成功下载的附件可以离线访问。
- **Link only**：仅保存媒体链接。笔记仍在本地，但打开媒体需要联网，链接也可能过期。请以保存结果和 Vault 中的实际文件为准。

### 套餐与支付

在插件内查看订阅套餐、选择套餐及计费周期并发起支付，然后在打开的收银台页面完成付款。**支付宝和微信支付仅在支持的套餐和计费周期可用**；它们是所选周期的一次性付款，**不会自动续费**。

| 套餐 | 月付（美元） | 年付（美元） | 每月额度 |
| --- | --- | --- | --- |
| Basic | 免费 | 免费 | 20 |
| Pro | $2.90 | $29.90 | 300 |
| Ultra | $6.90 | $69.90 | 1,000 |
| Mega | $9.90 | $99.90 | 2,000 |

年付套餐按年收费，额度仍按月刷新。未用完的订阅额度在下个额度周期开始时重置。加量包为一次性购买：200 / 600 / 1,200 credits 分别为 $2.90 / $6.90 / $9.90，不会过期。优先使用订阅额度，再使用加量包。获取失败不扣额度。升级立即生效，降级或取消在当前订阅周期结束时生效。

以上价格沿用 2026 年 10 月 14 日的记录，最新价格以 [AgentLens 官方定价页](https://agentlensapi.io/pricing)为准。

### 本地文件、剪贴板与联网

桌面端下载媒体时，会先写入操作系统临时目录下由插件创建的文件夹（位于 Vault 外），单个文件上限为 **5 GiB**。下载完成后才复制到 Vault，未完成的下载不会报告为已保存。正常完成或处理失败后会清理临时文件；应用崩溃时，文件可能保留至系统清理。请为临时目录和 Vault 预留足够的磁盘空间。

插件会读取 Vault 路径以展示目标文件夹和文件数量，并检查所选文件夹的笔记以查找以前的导入记录。这些操作不会上传 Vault 内容。只有调用 **Fetch from clipboard** 时才读取剪贴板；**Copy diagnostics** 会在你主动操作时复制经过隐私处理的诊断摘要。

获取内容时，插件会向 [AgentLens API](https://agentlensapi.io) 发送你请求的来源链接；账号操作需要身份验证信息。使用 Google 登录时会连接 Google，订阅结算由 Stripe 处理，获取或展示远程媒体时可能访问来源平台和媒体托管服务。

保存笔记并下载媒体时，保存界面会显示已完成的下载数量和实际已下载的数据量；能获取文件总大小时，也会显示总大小和完成百分比。保存时可同时下载更多媒体文件。媒体请求被拒绝时，插件可能向 AgentLens API 获取下载恢复策略，适用场景包括符合条件的 TikTok 视频。

### 常见问题与支持

- **登录未完成**：检查网络，完成账号页面或 Google 登录流程后返回 Obsidian；仍未连接可重试登录。
- **链接无法获取**：确认链接完整、公开且受支持；如果来源受限或已失效，请尝试另一条公开链接。
- **额度不足**：重试前先检查插件中的账号和套餐信息。
- **无法保存笔记**：确认 Vault 可写、目标文件夹有效，并根据错误提示处理后再重试。
- **深色模式下看不清**：请切换到 Obsidian 浅色主题。

请在本仓库的 **Issues** 中反馈问题，注明插件版本、Obsidian 版本、操作系统、复现步骤和报错。尽量使用公开示例链接，不要提交密码、令牌、支付信息或私有 Vault 内容。

插件以 [MIT 许可证](LICENSE)发布，版权归 Wiphox, LLC（2026 年）所有。AgentLens Social Importer 是第三方插件，并非 Obsidian 官方产品。
