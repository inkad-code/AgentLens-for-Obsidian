import { expect, it, vi } from "vitest";
import { parallelEach, parallelBySize, transfer, SMALL_FILE_LIMIT, downloadDeadline, assertDownloadSpace } from "../src/runtime/TransferPool";
import { DesktopMediaDownloader } from "../src/vault/DesktopMediaDownloader";
const pause = () => { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; };
it("admits eight small files and cancels waiters without starting work", async () => {
 const gate = pause(); let active = 0, peak = 0;
 const jobs = Array.from({length: 8}, () => transfer("small", async () => { active++; peak=Math.max(peak,active); await gate.promise; active--; }, undefined, {sizeBytes: 10}));
 await vi.waitFor(()=>expect(active).toBe(8));
 const c = new AbortController(); const pending = transfer("small", async()=>{throw Error("must not start");}, c.signal, {sizeBytes:10});
 const rejected=expect(pending).rejects.toThrow(); c.abort(); await rejected;
 gate.release(); await Promise.all(jobs); expect(peak).toBe(8); expect(active).toBe(0);
});
it("limits large and unknown files to four while independent small files use spare capacity", async () => {
 const gate=pause(); let large=0,small=0;
 const big=Array.from({length:8},(_,i)=>transfer("mixed", async()=>{large++; await gate.promise; large--;},undefined,i%2?{}:{sizeBytes:SMALL_FILE_LIMIT}));
 await vi.waitFor(()=>expect(large).toBe(4));
 const little=Array.from({length:4},()=>transfer("mixed",async()=>{small++;await gate.promise;small--;},undefined,{sizeBytes:1}));
 await vi.waitFor(()=>expect(small).toBe(4));expect(large).toBe(4);gate.release();await Promise.all([...big,...little]);
});
it("admits a queued desktop transfer when renderer timers are throttled", async () => {
  const gate = pause();
  const downloader = new DesktopMediaDownloader();
  const options = { waitForSlot: downloader.waitForTransferSlot };
  let active = 0;
  const holders = Array.from({ length: 4 }, () => transfer("desktop-background", async () => {
    active++;
    await gate.promise;
  }, undefined, options));
  await vi.waitFor(() => expect(active).toBe(4));

  const rendererTimer = globalThis.setTimeout;
  const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, milliseconds, ...args) => {
    if (milliseconds === 20) throw new Error("Renderer queue timer is throttled.");
    return rendererTimer(callback, milliseconds, ...args);
  });
  const admitted = vi.fn(() => Promise.resolve());
  const queued = transfer("desktop-background", admitted, undefined, options);
  try {
    await downloader.waitForTransferSlot(40);
    expect(admitted).not.toHaveBeenCalled();
    gate.release();
    await queued;
    expect(admitted).toHaveBeenCalledOnce();
  } finally {
    gate.release();
    await Promise.allSettled([...holders, queued]);
    spy.mockRestore();
  }
});
it("reclassifies an unknown response without restarting or releasing its total slot", async()=>{
 const gate=pause();let active=0;
 const jobs=Array.from({length:8},()=>transfer("headers",async lease=>{await lease.updateSize(1024);active++;await gate.promise;active--;}));
 await vi.waitFor(()=>expect(active).toBe(8));gate.release();await Promise.all(jobs);
});
it("pauses promotion until a large slot is free and cancels promotion waits",async()=>{
 const gates=Array.from({length:4},pause);let large=0;
 const jobs=gates.map(g=>transfer("promote",async()=>{large++;await g.promise;large--;},undefined,{sizeBytes:SMALL_FILE_LIMIT}));
 await vi.waitFor(()=>expect(large).toBe(4));
 const c=new AbortController();let started=false;
 const promoted=transfer("promote",async lease=>{started=true;await lease.updateSize(SMALL_FILE_LIMIT,c.signal);},undefined,{sizeBytes:1});
 await vi.waitFor(()=>expect(started).toBe(true));const rejected=expect(promoted).rejects.toThrow();c.abort();await rejected;
 gates.forEach(g=>g.release());await Promise.all(jobs);
});
it("retains compatibility buffer cap and holds transfer capacity through publication",async()=>{
 const gate=pause();let active=0;const jobs=Array.from({length:5},()=>transfer("buffered",async()=>{active++;await gate.promise;active--;},undefined,{sizeBytes:1,buffered:true}));
 await vi.waitFor(()=>expect(active).toBe(2));gate.release();await Promise.all(jobs);
});
it("shares caps across independent module instances with Web Locks",async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');const held=new Set<string>();
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(name:string,_options:unknown,callback:(lock:unknown)=>Promise<unknown>)=>{if(held.has(name))return callback(null);held.add(name);try{return await callback({name});}finally{held.delete(name);}}}}});
 const gate=pause();let active=0;let other:typeof import('../src/runtime/TransferPool');
 try {vi.resetModules();other=await import('../src/runtime/TransferPool');const jobs=Array.from({length:12},(_,i)=>(i%2?other.transfer:transfer)("windows",async()=>{active++;await gate.promise;active--;},undefined,{sizeBytes:1}));await vi.waitFor(()=>expect(active).toBe(8));gate.release();await Promise.all(jobs);expect(held.size).toBe(0);}finally{gate.release();if(original)Object.defineProperty(globalThis,'navigator',original);else Reflect.deleteProperty(globalThis,'navigator');}
});
it("does not let a large-only batch worker backlog prevent small-file admission",async()=>{
 const gate=pause();let big=0,little=0;
 const items=[...Array.from({length:20},()=>SMALL_FILE_LIMIT),...Array.from({length:8},()=>1)];
 const batch=parallelBySize(items,async size=>{await transfer("batch",async()=>{if(size===1)little++;else big++;await gate.promise;},undefined,{sizeBytes:size});},size=>size);
 await vi.waitFor(()=>expect(little).toBeGreaterThanOrEqual(4));expect(big).toBeLessThanOrEqual(4);gate.release();await batch;
});
it("waits for active siblings to settle before propagating a worker failure",async()=>{
 let settled=false;await expect(parallelEach([1,2],async id=>{if(id===1)throw Error('failed');await new Promise(r=>setTimeout(r,10));settled=true;})).rejects.toThrow('failed');expect(settled).toBe(true);
});

it("scales large-file deadlines, preserves explicit overrides and checks disk headroom",()=>{
 expect(downloadDeadline(2*1024**3)).toBeGreaterThan(10*60_000);
 expect(downloadDeadline(5*1024**3)).toBe(2*60*60_000);
 expect(downloadDeadline(2*1024**3,30)).toBe(30);
 expect(()=>assertDownloadSpace({bavail:1024,bsize:4096},SMALL_FILE_LIMIT)).toThrow("disk space");
 expect(()=>assertDownloadSpace({bavail:1024**3,bsize:4096},SMALL_FILE_LIMIT)).not.toThrow();
});
