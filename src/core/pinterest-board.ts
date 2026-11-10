/** Matches the shared backend Board-only contract. Does not resolve short links or perform I/O. */
export const PINTEREST_BOARD_REQUIRED = "Use a Pinterest board link, not a profile link. Open the board you want and copy its link. For example: https://www.pinterest.com/newformcommunity/dailywebdesign/";
const domains = ["pinterest.com", "pinterest.co.uk", "pinterest.ca", "pinterest.de", "pinterest.fr", "pinterest.jp", "pinterest.com.au", "pin.it"];
const reserved = new Set(["pin", "search", "ideas", "today", "explore", "login", "logout", "signup", "settings", "business", "shopping", "notifications", "messages", "_saved", "_created", "saved", "created"]);
export class PinterestLinkError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string) { super(message); }
}
export function pinterestBoardUrl(value: string, follow = false): string {
  value = value.match(/https?:\/\/[^\s<>]+/i)?.[0] ?? value;
  let url: URL;
  try { url = new URL(value); } catch { return value; }
  if (!domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return value;
  const invalid = () => new PinterestLinkError("PINTEREST_BOARD_URL_REQUIRED", PINTEREST_BOARD_REQUIRED);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port && !["80", "443"].includes(url.port)) throw invalid();
  // Inspect raw path so URL's dot-segment normalization cannot turn an unsupported route into a Board.
  const rawPath = value.match(/^https?:\/\/[^/]+([^?#]*)/i)?.[1] ?? "";
  const parts = rawPath.split("/");
  if (parts[1]?.toLowerCase() === "pin") throw new PinterestLinkError("PINTEREST_PIN_IN_BOARD_FLOW", follow
    ? "To follow Pinterest updates, paste a board link instead of a Pin link."
    : "This is a Pin link. Use Single post fetch, or paste a board link to fetch multiple Pins.");
  const segment = (part: string | undefined) => Boolean(part && !reserved.has(part.toLowerCase()) && !part.startsWith("_")
    && part !== "." && part !== ".." && !/%(?:2f|5c|00|2e)/i.test(part) && !part.includes("\\"));
  if (url.hostname === "pin.it" || url.hostname.endsWith(".pin.it")
      || !(parts.length === 3 || parts.length === 4 && parts[3] === "") || !segment(parts[1]) || !segment(parts[2])) throw invalid();
  const host = url.hostname === "pinterest.com" ? "www.pinterest.com" : url.hostname;
  return `https://${host}/${parts[1]}/${parts[2]}/`;
}

/** Presentation variant for the approved, copyable Pinterest correction instructions. */
export function isPinterestGuidance(message?: string | null): boolean {
  return Boolean(message && ["Use a Pinterest board link", "This is a Pin link", "To follow Pinterest updates"].some(prefix => message.startsWith(prefix)));
}
