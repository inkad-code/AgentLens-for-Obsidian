/** Minimal Electron bridge used only for system proxy resolution on desktop. */
declare module "@electron/remote" {
  interface ProxySession { resolveProxy(url: string): Promise<string>; }
  export const session: { defaultSession?: ProxySession } | undefined;
  export const getCurrentWebContents: (() => { session?: ProxySession }) | undefined;
}
declare module "electron" {
  export const remote: typeof import("@electron/remote") | undefined;
}
