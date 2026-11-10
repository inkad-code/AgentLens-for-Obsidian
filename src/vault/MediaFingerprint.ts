export interface MediaFingerprint { sizeBytes: number; sha256: string }
export interface MediaPublicationIntent extends MediaFingerprint { mediaId: string; path: string }
export async function fingerprintBytes(bytes: ArrayBuffer): Promise<MediaFingerprint> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return { sizeBytes: bytes.byteLength, sha256: Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("") };
}
