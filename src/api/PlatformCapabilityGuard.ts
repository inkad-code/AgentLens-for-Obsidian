/** Only syntax is checked locally. Platform, plan and mode rules belong to the shared API. */
export function requirePublicLink(rawUrl: string): void {
  let url: URL;
  try { url = new URL(rawUrl); }
  catch { throw new Error("Enter a valid public HTTP or HTTPS link."); }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new Error("Enter a valid public HTTP or HTTPS link without credentials.");
  }
}
