// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopMediaDownloader, publishDesktopMedia, systemProxyEndpoint } from "../src/vault/DesktopMediaDownloader";
import { DESKTOP_MEDIA_DOWNLOAD_LIMIT, MOBILE_MEDIA_DOWNLOAD_LIMIT } from "../src/core/platformPolicy";
let server: Server; let url: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("Content-Type", "video/mp4");
    if (req.url === "/oversize") { res.setHeader("Content-Length", String(5 * 1024 ** 3 + 1)); res.end(); return; }
    if (req.url === "/redirect") { res.writeHead(302, { Location: "/ok" }); res.end(); return; }
    if (req.url === "/html") { res.end("<html>Forbidden</html>"); return; }
    if (req.url === "/partial") { res.setHeader("Content-Length", 4096); res.write(new Uint8Array(1024)); setTimeout(() => res.destroy(), 10); return; }
    if (req.url === "/slow") { res.write(new Uint8Array(1024)); return; }
    const total = req.url === "/large" ? 32 * 1024 ** 2 : 4096;
    if (req.url !== "/unknown") res.setHeader("Content-Length", total);
    let remaining = total;
    const send = () => { while (remaining) { const chunk = new Uint8Array(Math.min(65536, remaining)).fill(42); remaining -= chunk.length; if (!res.write(chunk)) { res.once("drain", send); return; } } res.end(); };
    send();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
const media = (route: string) => ({ id:"v", kind:"video" as const, sourceUrl:url+route });
it("uses 5 GiB desktop and 50 MiB mobile policies", () => {
 expect(DESKTOP_MEDIA_DOWNLOAD_LIMIT).toBe(5 * 1024 ** 3); expect(MOBILE_MEDIA_DOWNLOAD_LIMIT).toBe(50 * 1024 ** 2);
});
it("streams a 32 MiB file and publishes without replacing an existing destination", async () => {
 const file=await new DesktopMediaDownloader(undefined, undefined, undefined, async () => "DIRECT").download(media("/large"));
 const vault=await mkdtemp(join(tmpdir(),"al-vault-test-"));
 try {
  expect(file.sizeBytes).toBe(32 * 1024 ** 2);
  await publishDesktopMedia(file,vault,"saved.mp4");
  expect((await stat(join(vault,"saved.mp4"))).size).toBe(file.sizeBytes);
  await expect(publishDesktopMedia(file,vault,"saved.mp4")).rejects.toThrow();
  expect(await readdir(vault)).toEqual(["saved.mp4"]);
  await expect(publishDesktopMedia(file,vault,"../outside.mp4")).rejects.toThrow("outside");
 } finally { await file.cleanup(); await rm(vault,{recursive:true,force:true}); }
 await expect(stat(file.path)).rejects.toThrow();
});
it("rejects over-limit headers and counts unknown-size streams", async () => {
 await expect(new DesktopMediaDownloader(undefined, undefined, undefined, async () => "DIRECT").download(media("/oversize"))).rejects.toThrow("5 GiB");
 await expect(new DesktopMediaDownloader(2048, undefined, undefined, async () => "DIRECT").download(media("/unknown"))).rejects.toThrow("limit");
});
it("rejects truncated responses and error documents", async () => {
 await expect(new DesktopMediaDownloader(undefined, undefined, undefined, async () => "DIRECT").download(media("/partial"))).rejects.toThrow();
 await expect(new DesktopMediaDownloader(undefined, undefined, undefined, async () => "DIRECT").download(media("/html"))).rejects.toThrow("document");
});
it("follows redirects and preserves the downloaded bytes", async () => {
 const f=await new DesktopMediaDownloader(undefined, undefined, undefined, async () => "DIRECT").download(media("/redirect"));
 try {expect(new Uint8Array(await readFile(f.path))).toEqual(new Uint8Array(4096).fill(42));} finally {await f.cleanup();}
});
it("aborts idle bodies and releases slots", async () => {
 const before=(await readdir(tmpdir())).filter(x=>x.startsWith("agentlens-obsidian-media-"));
 const controller=new AbortController();
 const promise=new DesktopMediaDownloader(undefined, undefined, undefined, async () => "DIRECT").download(media("/slow"),controller.signal);
 setTimeout(()=>controller.abort(),30);
 await expect(promise).rejects.toThrow("canceled");
 await expect(new DesktopMediaDownloader(undefined,30, undefined, async () => "DIRECT").download(media("/slow"))).rejects.toThrow("timed out");
 const after=(await readdir(tmpdir())).filter(x=>x.startsWith("agentlens-obsidian-media-"));
 expect(after.sort()).toEqual(before.sort());
});

it.each([
 ['DIRECT', undefined], ['PROXY proxy.example:80', 'http://proxy.example/'], ['HTTPS proxy.example:443', 'https://proxy.example/'], ['PROXY 127.0.0.1:7890', 'http://127.0.0.1:7890/'],
 ['HTTPS proxy.example:8443', 'https://proxy.example:8443/'],
 ['SOCKS5 [::1]:1080', 'socks5h://[::1]:1080'],
 ['PROXY proxy.example:7890; DIRECT', 'http://proxy.example:7890/']
])('honors system route %s', (policy, endpoint) => expect(systemProxyEndpoint(policy)).toBe(endpoint));
it('rejects missing or unrecognized proxy policy instead of silently going direct', () => {
 for(const value of ['', 'INVALID proxy:80', 'PROXY user:pass@proxy:80']) expect(()=>systemProxyEndpoint(value)).toThrow();
});
it('streams through the selected proxy and resolves again on redirect', async () => {
 const requests:string[]=[];
 const proxy=createServer((req,res)=>{
  requests.push(req.url!);
  if(req.url==='http://unresolvable.invalid/redirect') {res.writeHead(302,{Location:'http://second.invalid/media'});res.end();return;}
  res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':'4096'});res.end(new Uint8Array(4096).fill(42));
 });
 await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const resolver=vi.fn(async(_url: string)=>`PROXY 127.0.0.1:${(proxy.address() as {port:number}).port}`);
 try {
  const file=await new DesktopMediaDownloader(undefined,undefined,undefined,resolver).download({id:'proxy',kind:'video',sourceUrl:'http://unresolvable.invalid/redirect'});
  try {expect(file.sizeBytes).toBe(4096);expect(new Uint8Array(await readFile(file.path))).toEqual(new Uint8Array(4096).fill(42));}finally{await file.cleanup();}
  expect(requests).toEqual(['http://unresolvable.invalid/redirect','http://second.invalid/media']);
  expect(resolver.mock.calls.map(c=>c[0])).toEqual(requests);
 }finally{proxy.closeAllConnections();await new Promise<void>(resolve=>proxy.close(()=>resolve()));}
});
it('does not fall back to a working direct origin when the configured proxy is unavailable', async()=>{
 const downloader=new DesktopMediaDownloader(undefined,2000,undefined,async()=> 'PROXY 127.0.0.1:1; DIRECT');
 await expect(downloader.download(media('/ok'))).rejects.toThrow();
});
it('cancels while resolving system proxy settings',async()=>{
 const downloader=new DesktopMediaDownloader(undefined,30,undefined,()=>new Promise(()=>{}));
 await expect(downloader.download(media('/ok'))).rejects.toThrow('timed out');
});
