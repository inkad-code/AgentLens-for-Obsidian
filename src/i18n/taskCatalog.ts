export const taskEnglish = {
  "tasks.title": "Auto Fetch tasks", "tasks.loading": "Loading tasks…", "tasks.history": "Check Task History",
  "tasks.importing": "Importing", "tasks.completed": "Import Completed", "tasks.failed": "Import Failed",
  "tasks.back": "Back", "tasks.filterLabel": "Import status", "tasks.all": "All", "tasks.completedTab": "Completed", "tasks.failedTab": "Failed",
  "tasks.overallTitle": "Importing to Obsidian…", "tasks.overallHint": "Saving notes and attachments to your Vault",
  "tasks.cancelAll": "Cancel All Fetch", "tasks.cancel": "Cancel", "tasks.retry": "Retry", "tasks.refresh": "Refresh tasks",
  "tasks.empty": "No tasks yet", "tasks.more": "More", "tasks.moreFiles": "More files", "tasks.loadingMore": "Loading…",
  "tasks.saveTo": "SAVE TO", "tasks.requestId": "Request ID", "tasks.credits": "{count} credits", "tasks.detail": "View Detail",
  "tasks.importedCount": "Imported: {count}", "tasks.skippedCount": "Skipped: {count}", "tasks.failedCount": "Failed: {count}",
  "tasks.total": "Total: {count}", "tasks.newPosts": "New posts: {count}", "tasks.notes": "Notes: {count}",
  "tasks.fetchFailed": "Fetching Failed", "tasks.parseError": "Parsing error", "tasks.note": "Note",
  "tasks.emptyCheck": "Check completed · No new content", "tasks.noNewPosts": "No new posts to save.",
  "tasks.noContent": "No notes or attachments were received.", "tasks.unknownSize": "Size unknown",
  "tasks.taskProgress": "Task progress", "tasks.overallProgress": "Overall progress", "tasks.fileProgress": "Downloading {name}",
  "tasks.checking": "Checking for new posts…", "tasks.downloading": "Downloading", "tasks.saving": "Saving to Vault…",
  "tasks.saved": "Imported", "tasks.skipped": "Skipped", "tasks.linked": "Link only", "tasks.fileFailed": "Failed",
  "tasks.cancelled": "Cancelled", "tasks.waiting": "Waiting for recovery", "tasks.notesSaved": "{saved} / {total} notes saved",
  "tasks.noRetry": "This task has no failed files to retry."
} as const;

export const taskSimplified: Record<keyof typeof taskEnglish, string> = {
  "tasks.title": "自动抓取任务", "tasks.loading": "正在加载任务…", "tasks.history": "查看任务历史",
  "tasks.importing": "导入中", "tasks.completed": "导入完成", "tasks.failed": "导入失败",
  "tasks.back": "返回", "tasks.filterLabel": "导入状态", "tasks.all": "全部", "tasks.completedTab": "已完成", "tasks.failedTab": "失败",
  "tasks.overallTitle": "正在导入 Obsidian…", "tasks.overallHint": "正在将笔记和附件保存到仓库",
  "tasks.cancelAll": "取消全部抓取", "tasks.cancel": "取消", "tasks.retry": "重试", "tasks.refresh": "刷新任务",
  "tasks.empty": "暂无任务", "tasks.more": "更多", "tasks.moreFiles": "更多文件", "tasks.loadingMore": "加载中…",
  "tasks.saveTo": "保存到", "tasks.requestId": "请求 ID", "tasks.credits": "{count} 积分", "tasks.detail": "查看详情",
  "tasks.importedCount": "已导入：{count}", "tasks.skippedCount": "已跳过：{count}", "tasks.failedCount": "失败：{count}",
  "tasks.total": "总计：{count}", "tasks.newPosts": "新内容：{count}", "tasks.notes": "笔记：{count}",
  "tasks.fetchFailed": "抓取失败", "tasks.parseError": "解析错误", "tasks.note": "笔记",
  "tasks.emptyCheck": "检查完成 · 暂无新内容", "tasks.noNewPosts": "没有需要保存的新内容。",
  "tasks.noContent": "未收到笔记或附件。", "tasks.unknownSize": "大小未知",
  "tasks.taskProgress": "任务进度", "tasks.overallProgress": "总体进度", "tasks.fileProgress": "正在下载 {name}",
  "tasks.checking": "正在检查新内容…", "tasks.downloading": "下载中", "tasks.saving": "正在保存到仓库…",
  "tasks.saved": "已导入", "tasks.skipped": "已跳过", "tasks.linked": "仅链接", "tasks.fileFailed": "失败",
  "tasks.cancelled": "已取消", "tasks.waiting": "等待恢复", "tasks.notesSaved": "已保存 {saved} / {total} 篇笔记",
  "tasks.noRetry": "此任务没有需要重试的失败文件。"
};

export const taskTraditional: Record<keyof typeof taskEnglish, string> = {
  "tasks.title": "自動擷取任務", "tasks.loading": "正在載入任務…", "tasks.history": "查看任務歷史",
  "tasks.importing": "匯入中", "tasks.completed": "匯入完成", "tasks.failed": "匯入失敗",
  "tasks.back": "返回", "tasks.filterLabel": "匯入狀態", "tasks.all": "全部", "tasks.completedTab": "已完成", "tasks.failedTab": "失敗",
  "tasks.overallTitle": "正在匯入 Obsidian…", "tasks.overallHint": "正在將筆記與附件儲存至知識庫",
  "tasks.cancelAll": "取消全部擷取", "tasks.cancel": "取消", "tasks.retry": "重試", "tasks.refresh": "重新整理任務",
  "tasks.empty": "暫無任務", "tasks.more": "更多", "tasks.moreFiles": "更多檔案", "tasks.loadingMore": "載入中…",
  "tasks.saveTo": "儲存至", "tasks.requestId": "請求 ID", "tasks.credits": "{count} 點數", "tasks.detail": "查看詳情",
  "tasks.importedCount": "已匯入：{count}", "tasks.skippedCount": "已略過：{count}", "tasks.failedCount": "失敗：{count}",
  "tasks.total": "總計：{count}", "tasks.newPosts": "新內容：{count}", "tasks.notes": "筆記：{count}",
  "tasks.fetchFailed": "擷取失敗", "tasks.parseError": "解析錯誤", "tasks.note": "筆記",
  "tasks.emptyCheck": "檢查完成 · 暫無新內容", "tasks.noNewPosts": "沒有需要儲存的新內容。",
  "tasks.noContent": "未收到筆記或附件。", "tasks.unknownSize": "大小未知",
  "tasks.taskProgress": "任務進度", "tasks.overallProgress": "整體進度", "tasks.fileProgress": "正在下載 {name}",
  "tasks.checking": "正在檢查新內容…", "tasks.downloading": "下載中", "tasks.saving": "正在儲存至知識庫…",
  "tasks.saved": "已匯入", "tasks.skipped": "已略過", "tasks.linked": "僅連結", "tasks.fileFailed": "失敗",
  "tasks.cancelled": "已取消", "tasks.waiting": "等待恢復", "tasks.notesSaved": "已儲存 {saved} / {total} 篇筆記",
  "tasks.noRetry": "此任務沒有需要重試的失敗檔案。"
};
