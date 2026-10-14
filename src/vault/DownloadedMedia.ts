/** Desktop downloads remain on disk through publication; mobile keeps its existing buffer path. */
export interface DownloadedMediaFile {
  kind: "file";
  path: string;
  sizeBytes: number;
  cleanup(): Promise<void>;
}
export type DownloadedMedia = ArrayBuffer | DownloadedMediaFile;
