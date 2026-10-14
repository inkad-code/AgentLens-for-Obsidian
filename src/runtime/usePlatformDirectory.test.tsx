import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlatformDirectory } from "./usePlatformDirectory";
const data = (accountId = "a", plan = "pro") => ({accountId, plan});
const settle = async () => { await act(async () => {}); };
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const options = (load: () => Promise<ReturnType<typeof data>>) => ({accountId:"a",installationId:"i",plan:"pro",clientType:"plugin",enabled:true,load,ownerWindow:window});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("shared directory refresh contract", () => {
  it("merges manual refreshes with an in-flight refresh", async () => {
    let finish!: (value: ReturnType<typeof data>) => void;
    const load = vi.fn().mockResolvedValueOnce(data()).mockImplementation(() => new Promise(resolve => { finish=resolve; }));
    const h=renderHook(()=>usePlatformDirectory(options(load))); await settle();
    let first!: Promise<void>, second!: Promise<void>;
    act(()=>{first=h.result.current.refresh();second=h.result.current.refresh();}); await settle();
    expect(first).toBe(second); expect(load).toHaveBeenCalledTimes(2);
    await act(async()=>{finish(data());await first;});
  });
  it("isolates changed loaders immediately and rejects late old responses", async () => {
    let finish!: (value: ReturnType<typeof data>) => void;
    const old=vi.fn(()=>new Promise<ReturnType<typeof data>>(r=>{finish=r;}));
    const next=vi.fn().mockRejectedValue(new Error("offline"));
    const h=renderHook(({load})=>usePlatformDirectory(options(load)),{initialProps:{load:old as ()=>Promise<ReturnType<typeof data>>}});
    await settle();h.rerender({load:next});expect(h.result.current.result).toBeUndefined();await settle();
    await act(async()=>finish(data()));expect(h.result.current.result?.data).toBeUndefined();
    expect(h.result.current.result?.failed).toBe(true);
  });
  it("clears old scope on account, installation and plan changes", async () => {
    const load=vi.fn().mockResolvedValue(data());
    const h=renderHook(({accountId,installationId,plan})=>usePlatformDirectory({...options(load),accountId,installationId,plan}),{initialProps:{accountId:"a",installationId:"i",plan:"pro"}});
    await settle();
    for(const change of [{accountId:"a",installationId:"j",plan:"pro"},{accountId:"b",installationId:"j",plan:"pro"},{accountId:"b",installationId:"j",plan:"mega"}]) {
      load.mockResolvedValue(data(change.accountId,change.plan));h.rerender(change);
      expect(h.result.current.result).toBeUndefined();await settle();expect(h.result.current.result?.data).toEqual(data(change.accountId,change.plan));
    }
    expect(load).toHaveBeenCalledTimes(4);
  });
  it("rejects data belonging to another plan", async () => {
    const load=async()=>data("a","mega");
    const h=renderHook(()=>usePlatformDirectory(options(load)));await settle();
    expect(h.result.current.result).toEqual({failed:true});
  });
  it("retains scoped data, respects backoff despite focus, and recovers", async () => {
    vi.useFakeTimers();const load=vi.fn().mockResolvedValueOnce(data()).mockRejectedValue(new Error("offline"));
    const h=renderHook(()=>usePlatformDirectory(options(load)));await settle();await advance(300000);
    expect(h.result.current.result).toEqual({data:data(),failed:true});
    let calls=2;
    for(const delay of [60000,120000,240000,480000,900000,900000]) {
      await advance(delay-1);act(()=>window.dispatchEvent(new Event("focus")));expect(load).toHaveBeenCalledTimes(calls);
      await advance(1);expect(load).toHaveBeenCalledTimes(++calls);
    }
    load.mockResolvedValue(data());await advance(900000);expect(h.result.current.result?.failed).toBeUndefined();
    const recovered=load.mock.calls.length;await advance(299999);expect(load).toHaveBeenCalledTimes(recovered);await advance(1);expect(load).toHaveBeenCalledTimes(recovered+1);
  });
  it("pauses hidden polling and coalesces wakeup events", async () => {
    vi.useFakeTimers();let visibility: DocumentVisibilityState="visible";
    vi.spyOn(document,"visibilityState","get").mockImplementation(()=>visibility);
    const load=vi.fn().mockResolvedValue(data());const h=renderHook(()=>usePlatformDirectory(options(load)));await settle();
    visibility="hidden";act(()=>document.dispatchEvent(new Event("visibilitychange")));await advance(900000);expect(load).toHaveBeenCalledTimes(1);
    visibility="visible";act(()=>{document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new Event("focus"));});await settle();expect(load).toHaveBeenCalledTimes(2);
    h.unmount();await advance(900000);expect(load).toHaveBeenCalledTimes(2);
  });
});

it("revalidates unchanged data without a state update and preserves data through failure recovery", async () => {
  vi.useFakeTimers();
  const load=vi.fn().mockImplementation(async()=>({plan:"pro",accountId:"a"}));
  let renders=0;
  const h=renderHook(()=>{renders++;return usePlatformDirectory(options(load));});await settle();
  const result=h.result.current.result;const count=renders;
  load.mockResolvedValue({accountId:"a",plan:"pro"});
  await advance(300000);
  expect(load).toHaveBeenCalledTimes(2);expect(renders).toBe(count);expect(h.result.current.result).toBe(result);
  load.mockRejectedValue(new Error("offline"));await advance(300000);
  const failed=h.result.current.result;const failureRenders=renders;
  await advance(60000);expect(renders).toBe(failureRenders);expect(h.result.current.result).toBe(failed);
  load.mockResolvedValue({accountId:"a",plan:"pro"});await advance(120000);
  expect(h.result.current.result?.failed).toBeUndefined();expect(h.result.current.result?.data).toBe(result?.data);
  h.unmount();
});

it("publishes changed platform ordering", async () => {
  const load=vi.fn().mockResolvedValue({...data(),platforms:["x","zhihu"]});
  const h=renderHook(()=>usePlatformDirectory(options(load)));await settle();
  const old=h.result.current.result;
  load.mockResolvedValue({...data(),platforms:["zhihu","x"]});
  await act(async()=>h.result.current.refresh());
  expect(h.result.current.result).not.toBe(old);
  expect(h.result.current.result?.data).toMatchObject({platforms:["zhihu","x"]});
});
