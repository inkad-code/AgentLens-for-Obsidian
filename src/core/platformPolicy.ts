export const MOBILE_MEDIA_DOWNLOAD_LIMIT = 10 * 1024 * 1024;
export const DESKTOP_MEDIA_DOWNLOAD_LIMIT = 25 * 1024 * 1024;

export function mediaDownloadLimit(isMobile: boolean): number {
  return isMobile ? MOBILE_MEDIA_DOWNLOAD_LIMIT : DESKTOP_MEDIA_DOWNLOAD_LIMIT;
}
