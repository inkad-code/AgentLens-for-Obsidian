export const MOBILE_MEDIA_DOWNLOAD_LIMIT = 50 * 1024 * 1024;
export const DESKTOP_MEDIA_DOWNLOAD_LIMIT = 5 * 1024 * 1024 * 1024;

export function mediaDownloadLimit(isMobile: boolean): number {
  return isMobile ? MOBILE_MEDIA_DOWNLOAD_LIMIT : DESKTOP_MEDIA_DOWNLOAD_LIMIT;
}
