export type Locale = "en" | "zh-CN" | "zh-TW";

const english = {
  "note.properties": "Properties",
  "note.propertiesLabel": "Note properties",
  "creator.search": "Search creators",
  "creator.filterPlatform": "Creator platform",
  "creator.allPlatforms": "All platforms",
  "creator.filterState": "Monitoring status",
  "creator.allStates": "All statuses",
  "creator.enabled": "Enabled",
  "creator.paused": "Paused",
  "creator.needsAttention": "Needs attention",
  "creator.refresh": "Refresh creators",
  "creator.noMatches": "No matching creators.",
  "creator.openProfile": "Open creator profile",
  "creator.visibleCount": "{visible} of {total} creators",

  "app.subtitle": "Social research notes for this vault",
  "nav.single": "Single Fetch",
  "nav.bulk": "Bulk Fetch",
  "nav.auto": "Auto-fetch",
  "nav.activity": "Activity",
  "nav.settings": "Settings",
  "update.required.title": "Update required",
  "update.required.body": "Update AgentLens for Obsidian to version {version} or newer to continue online actions.",
  "update.available.title": "Update available",
  "update.available.body": "Version {version} is available. Update when you’re ready.",
  "update.releaseNotes": "Release notes",
  "update.install": "Update in Community Plugins",
  "update.dismiss": "Dismiss this version",
  "activity.creatorSettings": "Creator settings changed",
  "activity.creatorPause": "Creator paused",
  "activity.creatorResume": "Creator resumed",
  "activity.creatorDelete": "Creator deleted",
  "creator.lastChecked": "Last successful check",
  "creator.lastSaved": "Last saved",
  "creator.nextCheck": "Next check at",
  "creator.retryAt": "Retry at:",
  "creator.retryNow": "Retry now",
  "onboarding.title": "Build a traceable research vault",
  "onboarding.step1": "Sign in to connect this vault to AgentLens.",
  "onboarding.step2": "Review a post or creator page before saving anything.",
  "onboarding.step3": "Follow creators for host-active Auto-Fetch monitoring.",
  "onboarding.reviewStep2": "Preview a single public post before saving.",
  "onboarding.reviewStep3": "Save the reviewed post and media to your vault.",
  "onboarding.start": "Start with Single Fetch",
  "onboarding.skip": "Skip introduction",
  "backToTop": "Back to top"
} as const;

export type TranslationKey = keyof typeof english;

const simplified: Partial<Record<TranslationKey, string>> = {
  "note.properties": "笔记属性",
  "note.propertiesLabel": "笔记属性",
  "creator.search": "搜索创作者",
  "creator.filterPlatform": "创作者平台",
  "creator.allPlatforms": "全部平台",
  "creator.filterState": "监控状态",
  "creator.allStates": "全部状态",
  "creator.enabled": "已启用",
  "creator.paused": "已暂停",
  "creator.needsAttention": "需要处理",
  "creator.refresh": "刷新创作者",
  "creator.noMatches": "没有匹配的创作者。",
  "creator.openProfile": "打开创作者主页",
  "creator.visibleCount": "显示 {visible} / {total} 位创作者",

  "app.subtitle": "将社交内容整理为当前仓库中的研究笔记",
  "nav.single": "单条抓取",
  "nav.bulk": "批量抓取",
  "nav.auto": "自动抓取",
  "nav.activity": "活动记录",
  "nav.settings": "设置",
  "update.required.title": "需要更新",
  "update.required.body": "需要 {version} 或更高版本才能执行在线操作。",
  "update.available.title": "有可用更新",
  "update.available.body": "Obsidian 社区插件中已提供 {version} 版本。",
  "update.releaseNotes": "版本说明",
  "update.install": "前往社区插件更新",
  "update.dismiss": "忽略此版本",
  "activity.creatorPause": "已暂停 Creator",
  "activity.creatorResume": "已恢复 Creator",
  "activity.creatorDelete": "已删除 Creator",
  "creator.lastChecked": "最近成功检查",
  "creator.lastSaved": "最近保存",
  "creator.nextCheck": "下次检查时间",
  "creator.retryAt": "重试时间：",
  "creator.retryNow": "立即重试",
  "onboarding.title": "建立可追溯的研究仓库",
  "onboarding.step1": "登录后，将当前仓库连接到 AgentLens。",
  "onboarding.step2": "保存前先预览帖子或 Creator 页面。",
  "onboarding.step3": "关注 Creator，在 Obsidian 活跃时自动检查更新。",
  "onboarding.reviewStep2": "保存前先预览单条公开帖子。",
  "onboarding.reviewStep3": "将预览确认的帖子和媒体保存到仓库。",
  "onboarding.start": "从单条抓取开始",
  "onboarding.skip": "跳过介绍",
  "backToTop": "返回顶部"
};

const traditional: Partial<Record<TranslationKey, string>> = {
  "note.properties": "筆記屬性",
  "note.propertiesLabel": "筆記屬性",
  "creator.search": "搜尋創作者",
  "creator.filterPlatform": "創作者平台",
  "creator.allPlatforms": "全部平台",
  "creator.filterState": "監控狀態",
  "creator.allStates": "全部狀態",
  "creator.enabled": "已啟用",
  "creator.paused": "已暫停",
  "creator.needsAttention": "需要處理",
  "creator.refresh": "重新整理創作者",
  "creator.noMatches": "沒有符合的創作者。",
  "creator.openProfile": "開啟創作者主頁",
  "creator.visibleCount": "顯示 {visible} / {total} 位創作者",

  "app.subtitle": "將社交內容整理為目前知識庫中的研究筆記",
  "nav.single": "單筆擷取",
  "nav.bulk": "批次擷取",
  "nav.auto": "自動擷取",
  "nav.activity": "活動記錄",
  "nav.settings": "設定",
  "update.required.title": "需要更新",
  "update.required.body": "需要 {version} 或更新版本才能執行線上操作。",
  "update.available.title": "有可用更新",
  "update.available.body": "Obsidian 社群外掛中已提供 {version} 版本。",
  "update.releaseNotes": "版本說明",
  "update.install": "前往社群外掛更新",
  "update.dismiss": "略過此版本",
  "activity.creatorPause": "已暫停 Creator",
  "activity.creatorResume": "已恢復 Creator",
  "activity.creatorDelete": "已刪除 Creator",
  "creator.lastChecked": "最近成功檢查",
  "creator.lastSaved": "最近儲存",
  "creator.nextCheck": "下次檢查時間",
  "creator.retryAt": "重試時間：",
  "creator.retryNow": "立即重試",
  "onboarding.title": "建立可追溯的研究知識庫",
  "onboarding.step1": "登入後，將目前知識庫連接到 AgentLens。",
  "onboarding.step2": "儲存前先預覽貼文或 Creator 頁面。",
  "onboarding.step3": "關注 Creator，在 Obsidian 使用中自動檢查更新。",
  "onboarding.reviewStep2": "儲存前先預覽單則公開貼文。",
  "onboarding.reviewStep3": "將預覽確認的貼文與媒體儲存至知識庫。",
  "onboarding.start": "從單筆擷取開始",
  "onboarding.skip": "略過介紹",
  "backToTop": "返回頂端"
};

const catalogs: Record<Locale, Partial<Record<TranslationKey, string>>> = {
  en: english,
  "zh-CN": simplified,
  "zh-TW": traditional
};

export function resolveLocale(value?: string | null): Locale {
  const normalized = value?.replace("_", "-").toLowerCase();
  if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-mo") return "zh-TW";
  if (normalized?.startsWith("zh")) return "zh-CN";
  return "en";
}

export function translate(locale: string, key: TranslationKey, values: Readonly<Record<string, string | number>> = {}): string {
  const template = catalogs[resolveLocale(locale)][key] ?? english[key];
  return template.replace(/\{([^}]+)\}/g, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : token);
}
