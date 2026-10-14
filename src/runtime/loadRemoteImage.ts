import { requestUrl } from "obsidian";

export async function loadRemoteImage(url: string): Promise<Blob> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Invalid image URL.");
  const response = await requestUrl({ url, method: "GET", throw: false });
  const mime = Object.entries(response.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1]?.split(";")[0]?.trim() ?? "";
  if (response.status !== 200 || !/^image\/(png|jpeg|webp|gif|avif)$/.test(mime)
    || response.arrayBuffer.byteLength === 0 || response.arrayBuffer.byteLength > 8 * 1024 * 1024) throw new Error("Image unavailable.");
  return new Blob([response.arrayBuffer], { type: mime });
}
