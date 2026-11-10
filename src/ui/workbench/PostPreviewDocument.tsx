import type { ReactNode } from "react";
import type { NormalizedPost } from "../../core/domain";
import { postDisplayTitle } from "../../core/domain";
import { renderNotePreview, type NoteWriteManifest } from "../../vault/VaultWriter";
import { MarkdownPreview } from "./MarkdownPreview";
import { RemoteImage } from "./RemoteImage";

/** Compact display metadata; the saved note keeps its full write-plan properties. */
export function PostPreviewDocument({ post, manifest, contentStatus, videoCover }: {
  post: NormalizedPost;
  manifest: NoteWriteManifest;
  contentStatus?: ReactNode;
  videoCover?: string | undefined;
}) {
  const title = postDisplayTitle(post);
  const tags = manifest.frontmatter.tags;
  const tagList = Array.isArray(tags) ? tags.map(String).join(", ") : typeof tags === "string" ? tags : "";
  const metadata = [
    ["source", post.canonicalUrl || "—"],
    ["creator", post.author.displayName || "—"],
    ["published", post.publishedAt?.split("T")[0] || "—"],
    ["tags", `[${tagList}]`]
  ];
  let body = renderNotePreview(post, manifest);
  const heading = `# ${title}\n`;
  if (body.startsWith(heading)) body = body.slice(heading.length);
  // The editable Note section is empty in a preview; keep the source body intact.
  body = body.replace(/\n\n## Note\n$/, "").trimStart();
  const cover = videoCover && /^https?:\/\//i.test(videoCover) ? videoCover : undefined;
  const mediaStart = contentStatus || cover ? body.lastIndexOf("\n## Media\n") : -1;
  return <div className="agentlens-post-preview-document">
    <h3 className="agentlens-post-preview-title">{title}</h3>
    <dl className="agentlens-post-preview-metadata">{metadata.map(([label, value]) => <div key={label}>
      <dt>{label}:</dt><dd title={value}>{value}</dd>
    </div>)}</dl>
    <MarkdownPreview markdown={mediaStart < 0 ? body : body.slice(0, mediaStart).trimEnd()} sourcePath={manifest.notePath} />
    {contentStatus}
    {cover ? <section className="agentlens-post-preview-media">
      <MarkdownPreview markdown="## Media" sourcePath={manifest.notePath} />
      <RemoteImage url={cover} className="agentlens-post-preview-cover" alt="Video cover" />
    </section> : mediaStart >= 0 && <div className="agentlens-post-preview-media">
      <MarkdownPreview markdown={body.slice(mediaStart).trimStart()} sourcePath={manifest.notePath} />
    </div>}
  </div>;
}
