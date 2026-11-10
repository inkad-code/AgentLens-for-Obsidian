import { describe, it, expect } from "vitest";
import { pinterestBoardUrl, PINTEREST_BOARD_REQUIRED } from "../src/core/pinterest-board";
import { userMessage } from "../src/core/user-feedback";

describe("Pinterest Board input contract", () => {
  it.each(["/owner/", "/", "/search/pins/", "/owner/_saved/", "/owner/_created/", "/owner/board/section/", "/owner/a%2Fb/", "/owner//", "/owner/../board/", "/owner/%2E%2E/", "/owner/%5Cbad/"])("rejects %s before dispatch with actionable copy", path => {
    let error: unknown;
    try { pinterestBoardUrl(`https://www.pinterest.com${path}`, true); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect(userMessage(error)).toBe(PINTEREST_BOARD_REQUIRED);
  });
  it("normalizes harmless variants while retaining distinct boards, owners and case", () => {
    expect(pinterestBoardUrl("https://pinterest.com/owner/board?utm_source=share#fragment")).toBe("https://www.pinterest.com/owner/board/");
    expect(pinterestBoardUrl("https://www.pinterest.com/owner/Other/")).not.toBe(pinterestBoardUrl("https://www.pinterest.com/owner/board/"));
    expect(pinterestBoardUrl("https://www.pinterest.com/another/board/")).not.toBe(pinterestBoardUrl("https://www.pinterest.com/owner/board/"));
  });
  it.each([false,true])("gives the correct Pin guidance, follow=%s", follow => {
    let error: unknown; try { pinterestBoardUrl("https://www.pinterest.com/pin/123/", follow); } catch (caught) { error = caught; }
    expect(userMessage(error)).toBe(follow ? "To follow Pinterest updates, paste a board link instead of a Pin link." : "This is a Pin link. Use Single post fetch, or paste a board link to fetch multiple Pins.");
  });
  it("does not expand the domain allowlist or reinterpret other platforms", () => {
    expect(pinterestBoardUrl("https://pinterest.com.evil.example/owner/board/")).toBe("https://pinterest.com.evil.example/owner/board/");
    expect(pinterestBoardUrl("https://www.instagram.com/owner/")).toBe("https://www.instagram.com/owner/");
    expect(() => pinterestBoardUrl("https://pin.it/short")).toThrow(PINTEREST_BOARD_REQUIRED);
  });
  it("maps backend errors without showing internal text", () => {
    expect(userMessage({ code: "PINTEREST_BOARD_URL_REQUIRED", message: "internal" })).toBe(PINTEREST_BOARD_REQUIRED);
    expect(userMessage({ serverCode: "FOLLOW_TARGET_ALREADY_EXISTS", message: "internal" })).toBe("You’re already following this board.");
  });
});
