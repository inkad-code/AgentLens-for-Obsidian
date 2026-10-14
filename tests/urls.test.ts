import { describe, expect, it } from "vitest";
import { publicLinkFromText } from "@/core/urls";

describe("publicLinkFromText", () => {
  it("returns a bare URL unchanged", () => {
    expect(publicLinkFromText("https://www.douyin.com/video/1")).toBe("https://www.douyin.com/video/1");
  });

  it("trims surrounding whitespace", () => {
    expect(publicLinkFromText("  https://v.douyin.com/4a9qaT01UYA/  ")).toBe("https://v.douyin.com/4a9qaT01UYA/");
  });

  it("extracts the link from a Douyin share message", () => {
    const share = "2.51 :3pm J@i.CU 12/11 ztr:/ 全部学错！不要把in和on背成固定搭配！ # in # 介词 # 固定搭配 # 英语 # 英语思维  https://v.douyin.com/4a9qaT01UYA/ 复制此链接，打开Dou音搜索，直接观看视频！";
    expect(publicLinkFromText(share)).toBe("https://v.douyin.com/4a9qaT01UYA/");
  });

  it("extracts a link that sits between caption fragments", () => {
    expect(publicLinkFromText("看看这个 https://www.threads.com/@chen_tung 很有意思"))
      .toBe("https://www.threads.com/@chen_tung");
  });

  it("strips trailing sentence punctuation that follows the link", () => {
    expect(publicLinkFromText("(https://www.bilibili.com/video/BV1)")).toBe("https://www.bilibili.com/video/BV1");
    expect(publicLinkFromText("地址是 https://x.com/creator/status/1。")).toBe("https://x.com/creator/status/1");
  });

  it("keeps text without a link untouched", () => {
    expect(publicLinkFromText("not a link")).toBe("not a link");
  });
});

it("preserves HTTP share links for server resolution", () => {
  expect(publicLinkFromText("分享 http://xhslink.cn/o/59FBLL7oXKI 复制打开" )).toBe("http://xhslink.cn/o/59FBLL7oXKI");
  expect(publicLinkFromText("http://unknown.example/post")).toBe("http://unknown.example/post");
});
