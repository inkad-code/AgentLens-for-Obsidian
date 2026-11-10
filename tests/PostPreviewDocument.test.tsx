import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { NormalizedPost } from "@/core/domain";
import type { NoteWriteManifest } from "@/vault/VaultWriter";
import { PostPreviewDocument } from "@/ui/workbench/PostPreviewDocument";
import { MarkdownPreviewContext } from "@/ui/workbench/MarkdownPreview";

const post: NormalizedPost = {
 platform:"x",contentId:"actual-post",canonicalUrl:"https://x.com/creator/status/42",title:"An actual post",text:"Actual content",
 publishedAt:"2026-10-24T04:24:50Z",author:{id:"author",displayName:"Actual creator"},
 media:[{id:"photo",kind:"image",sourceUrl:"https://cdn.example/photo.jpg"}]
};
const manifest: NoteWriteManifest = {
 contentKey:"x:actual-post",notePath:"Inbox/post.md",action:"new",reason:"New note",managedDigest:"digest",mediaPolicy:"download_all",templateId:"default",
 expectedOutcome:"complete",partialReasons:[],frontmatter:{Platform:"x",Creator_name:"Actual creator",Source_url:post.canonicalUrl,Media_policy:"download_all",tags:["x","research"]},
 attachments:[{mediaId:"photo",path:"Inbox/attachments/photo.jpg",sourceUrl:"https://cdn.example/photo.jpg",action:"new"}],
 renderedManagedBlock:"# An actual post\n\n## Content\nActual content\n\n## Media\n- ![[Inbox/attachments/photo.jpg]]"
};

it("shows a title and four compact fields while preserving real body and media in the preview", () => {
 const before=JSON.stringify(manifest);
 const {container}=render(<PostPreviewDocument post={post} manifest={manifest} />);
 expect(screen.getByRole("heading",{name:"An actual post"})).toBeVisible();
 expect([...container.querySelectorAll("dt")].map(el=>el.textContent)).toEqual(["source:","creator:","published:","tags:"]);
 expect([...container.querySelectorAll("dd")].map(el=>el.textContent)).toEqual([post.canonicalUrl,"Actual creator","2026-10-24","[x, research]"]);
 const body=container.querySelector(".agentlens-markdown-preview")!.textContent!;
 expect(body).toContain("## Content\nActual content");
 expect(body).toContain("![Media preview](https://cdn.example/photo.jpg)");
 expect(body).not.toContain("# An actual post");
 expect(body).not.toContain("## Note");
 expect(body).not.toContain("Summary");
 expect(body).not.toContain("Key takeaways");
 expect(JSON.stringify(manifest)).toBe(before);
});

it("keeps provider headings and non-empty Note sections without adding example copy", () => {
 const body="## Summary\nReturned summary\n\n## Key takeaways\n- Returned point\n\n## Note\nExisting content";
 const renderMarkdown=vi.fn((markdown:string,element:HTMLElement)=>{element.textContent=markdown;return ()=>{};});
 render(<MarkdownPreviewContext.Provider value={renderMarkdown}><PostPreviewDocument post={post} manifest={{...manifest,renderedManagedBlock:`# An actual post\n\n${body}`}} /></MarkdownPreviewContext.Provider>);
 expect(renderMarkdown).toHaveBeenCalledWith(body,expect.any(HTMLElement),"");
});

it("handles long metadata and unavailable dates or tags without inventing values", () => {
 const url=`https://example.com/${"long-path/".repeat(30)}`;
 const {container}=render(<PostPreviewDocument post={{...post,canonicalUrl:url,publishedAt:undefined}} manifest={{...manifest,frontmatter:{}}} />);
 const values=[...container.querySelectorAll("dd")];
 expect(values[0]).toHaveAttribute("title",url);
 expect(values[2]).toHaveTextContent("—");
 expect(values[3]).toHaveTextContent("[]");
});
