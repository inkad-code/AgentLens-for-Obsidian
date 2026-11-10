import { hasAsciiControl } from "../core/controlCharacters";
export interface SharedFolderConfig { path: string; revision: number }
export interface ResolvedFolder { id: string; path: string }
export interface FolderAdoption {
  revision: number;
  path: string;
  folder?: ResolvedFolder;
  invalid?: boolean;
}
export interface SharedFolderPort {
  /** Each port is scoped to account, installation, stable target and follow. */
  load(): Promise<FolderAdoption | undefined>;
  persist(value: FolderAdoption): Promise<void>;
  list(): Promise<readonly ResolvedFolder[]>;
  create(path: string): Promise<ResolvedFolder>;
  /** Revalidate identity, target and the currently desired path revision before side effects. */
  current(): Promise<boolean>;
}
export class DestinationPathError extends Error {
  readonly code = "DESTINATION_PATH_INVALID";
  constructor() { super("The configured folder is no longer available. Reapply the shared folder configuration."); }
}
export function validateRelativeFolder(path: string): void {
  if (path.length > 1000 || /[\\:]/.test(path) || hasAsciiControl(path) || path.startsWith("/")
      || (path !== "" && path.split("/").some(part => !part || part === "." || part === "..")))
    throw new Error("Choose a relative folder inside the library or vault.");
}
const locks = new Map<string, Promise<unknown>>();
/** Durable directory authorization; never fetches source content or changes execution progress. */
export async function resolveSharedFolder(scope: string, desired: SharedFolderConfig, port: SharedFolderPort): Promise<ResolvedFolder> {
  const prior = locks.get(scope) ?? Promise.resolve();
  const run = prior.catch(() => undefined).then(async () => {
    validateRelativeFolder(desired.path);
    if (!Number.isSafeInteger(desired.revision) || desired.revision < 1) throw new Error("Invalid path revision.");
    const check = async () => { if (!await port.current()) throw new Error("The destination configuration changed."); };
    await check();
    const saved = await port.load();
    await check();
    if (saved && saved.revision > desired.revision) throw new Error("The destination configuration is stale.");
    if (saved?.revision === desired.revision && saved.path !== desired.path) throw new Error("Conflicting path revision.");
    const folders = await port.list();
    await check();
    const matches = folders.filter(f => f.path === desired.path);
    if (matches.length > 1) throw new Error("The configured folder name is ambiguous.");
    if (saved?.revision === desired.revision && saved.folder) {
      const found = matches.find(f => f.id === saved.folder!.id);
      if (!found || saved.invalid) {await port.persist({...saved, invalid: true});throw new DestinationPathError();}
      return found;
    }
    // Commit authorization before the first host side effect. A new path revision is required after adoption.
    await port.persist({revision: desired.revision, path: desired.path});
    await check();
    const folder = matches[0] ?? await port.create(desired.path);
    await check();
    if (folder.path !== desired.path) throw new Error("The host returned a different folder.");
    const verified = (await port.list()).filter(f => f.path === desired.path);
    await check();
    if (verified.length !== 1 || verified[0]!.id !== folder.id) throw new Error("The folder could not be verified.");
    await port.persist({revision: desired.revision, path: desired.path, folder});
    await check();
    return folder;
  });
  locks.set(scope, run);
  try { return await run; } finally { if (locks.get(scope) === run) locks.delete(scope); }
}
