// Host APIs must be injected explicitly in Node/jsdom tests.
export const remote = undefined;
export const session = undefined;
export function getCurrentWebContents(): never { throw new Error("Electron session unavailable in unit tests."); }
