/** Convert provider HTML into note content; plain Markdown stays unchanged. */
export function postBodyMarkdown(value: string, image?: (url: string) => string | undefined): string {
  if (!/<(?:p|div|section|article|br|h[1-6]|ul|ol|li|blockquote|strong|em|a|img|pre|table)\b/i.test(value)) return value;
  const document = new DOMParser().parseFromString(value, "text/html");
  function children(node: Node): string { return [...node.childNodes].map(render).join(""); }
  function render(node: Node): string {
    if (node.nodeType === 3) return (node.textContent ?? "").replace(/[\t\r\n ]+/g, " ");
    if (node.nodeType !== 1) return "";
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (["script", "style", "iframe", "object", "noscript", "nav"].includes(tag)) return "";
    if (tag === "br") return "\n";
    if (tag === "pre") {
      const text = element.textContent ?? "";
      const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
      return `\n\n${fence}\n${text.trim()}\n${fence}\n\n`;
    }
    const body = children(node);
    if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${body.trim()}\n\n`;
    if (["p", "div", "section", "article", "ul", "ol", "figure", "figcaption", "table", "tr"].includes(tag)) return `\n\n${body.trim()}\n\n`;
    if (tag === "td" || tag === "th") return `${body.trim()} | `;
    if (tag === "li") {
      const ordered = element.parentElement?.tagName.toLowerCase() === "ol";
      const index = ordered ? [...element.parentElement.children].indexOf(element) + 1 : 0;
      return `\n${ordered ? `${index}.` : "-"} ${body.trim().replace(/\n/g, "\n  ")}\n`;
    }
    if (tag === "blockquote") return `\n\n${body.trim().split("\n").map(line => `> ${line}`).join("\n")}\n\n`;
    if (tag === "strong" || tag === "b") return `**${body}**`;
    if (tag === "em" || tag === "i") return `*${body}*`;
    if (tag === "a") {
      const url = publicUrl(element.getAttribute("href"));
      return url ? `[${body.replace(/([[\]])/g, "\\$1")}](${url})` : body;
    }
    if (tag === "img") {
      const source = element.getAttribute("data-src") || element.getAttribute("src");
      const url = publicUrl(source);
      if (!url) return "";
      return `\n\n${image?.(source!) ?? `![${(element.getAttribute("alt") ?? "").replace(/([[\]])/g, "\\$1")}](${url})`}\n\n`;
    }
    return body;
  }
  return children(document.body).replace(/\n[ \t]+\n/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function publicUrl(value: string | null): string | undefined {
  if (!value || !/^https?:\/\//i.test(value.trim())) return undefined;
  return value.trim().replace(/[\s()<>]/g, char => encodeURIComponent(char));
}
