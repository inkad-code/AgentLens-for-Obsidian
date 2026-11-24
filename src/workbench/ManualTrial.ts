import type { FetchPage } from "../api/AgentLensApiClient";
import type { AuthService } from "../auth/AuthService";
import { AgentLensError } from "../core/errors";

export type TrialMode = "single_post" | "profile_page";
export type TrialInput = { mode: TrialMode; url: string; cursor?: string };
export type TrialBalance = { remaining: number; reserved: number; settled: number; accountLinked: boolean };
export type TrialExperience = { enrollmentId: string; mode: "A" | "B"; trial: TrialBalance | null };
export type TrialReply = {
  operationId: string;
  status: "processing" | "unknown" | "delivery_pending" | "failed" | "success_empty" | "success";
  balance: TrialBalance;
  page?: FetchPage;
  errorCode?: string;
};
export interface TrialApi {
  experience(credential: string): Promise<TrialExperience>;
  link(credential: string, token: string): Promise<TrialExperience>;
  fetch(credential: string, key: string, input: TrialInput, token?: string): Promise<TrialReply>;
  recover(id: string, identity: { credential: string } | { token: string }): Promise<TrialReply>;
}

type Intent = { key: string; input: TrialInput; operationId?: string; nextCursor?: string };
type StoredTrial = {
  version: 1;
  credential: string;
  experience?: TrialExperience;
  pending: Intent[];
  recent: Partial<Record<TrialMode, Intent>>;
  profileHistory?: Intent[];
  didShowSavePrompt?: boolean;
};

export type TrialUi = { mode?: TrialExperience["mode"]; balance?: TrialBalance; recoverSingle: boolean; recoverProfile: boolean };

/* This database is local to the Obsidian application profile, outside synchronized vault data. */
export class TrialDeviceStore {
  private opened: Promise<IDBDatabase> | undefined;

  constructor(private readonly service: string) {}

  read(): Promise<StoredTrial | undefined> {
    return this.access("readonly", current => ({ value: current }));
  }

  update<T>(change: (current: StoredTrial | undefined) => { state: StoredTrial; value: T }): Promise<T> {
    return this.access("readwrite", change);
  }

  private database(): Promise<IDBDatabase> {
    return this.opened ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("agentlens-obsidian-trial-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("trial");
      request.onerror = () => {
        this.opened = undefined;
        reject(new Error("The trial storage could not be opened.", { cause: request.error }));
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.opened = undefined; };
        resolve(request.result);
      };
    });
  }

  private async access<T>(mode: IDBTransactionMode, change: (current: StoredTrial | undefined) => { state?: StoredTrial; value: T }): Promise<T> {
    const db = await this.database();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("trial", mode);
      const store = tx.objectStore("trial");
      const request = store.get(this.service);
      let result: T;
      request.onsuccess = () => {
        try {
          const current = request.result as StoredTrial | undefined;
          if (current && (current.version !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(current.credential)
              || !Array.isArray(current.pending) || !current.recent)) throw new Error("The saved trial could not be opened.");
          const next = change(current);
          result = next.value;
          if (next.state) store.put(next.state, this.service);
        } catch (error) {
          reject(error instanceof Error ? error : new Error("The trial could not be stored on this device.", { cause: error }));
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("The trial could not be stored on this device."));
    });
  }
}

function required(current: StoredTrial | undefined): StoredTrial {
  if (!current) throw new Error("Start the trial before parsing a link.");
  return current;
}

function sameRequest(left: TrialInput, right: TrialInput): boolean {
  return left.mode === right.mode && left.url === right.url && left.cursor === right.cursor;
}

function status(state: StoredTrial | undefined): TrialUi {
  return { ...(state?.experience ? { mode: state.experience.mode } : {}),
    ...(state?.experience?.trial ? { balance: state.experience.trial } : {}),
    recoverSingle: Boolean(state?.recent.single_post || state?.pending.some(row => row.input.mode === "single_post")),
    recoverProfile: Boolean(state?.recent.profile_page || state?.pending.some(row => row.input.mode === "profile_page")) };
}

export class ManualTrial {
  constructor(private readonly api: TrialApi, private readonly store: TrialDeviceStore,
    private readonly auth: Pick<AuthService, "snapshot" | "sessionEpoch" | "accessToken">) {}

  async status(): Promise<TrialUi> { return status(await this.store.read()); }

  async transcriptCredential(newRequest: boolean): Promise<string> {
    const state = required(await this.store.read());
    if (state.experience?.mode !== "B") throw new Error("Sign in to parse your own links.");
    if (newRequest && (this.auth.snapshot().status !== "signed_out" || state.experience.trial?.accountLinked)) {
      throw new Error("Use your AgentLens account for new requests.");
    }
    return state.credential;
  }

  async rememberTranscriptBalance(balance: TrialBalance): Promise<void> {
    await this.store.update(current => {
      const state = required(current);
      if (state.experience?.mode === "B") {
        const prior = state.experience.trial;
        if (!prior || balance.settled >= prior.settled) {
          state.experience.trial = { ...balance, accountLinked: balance.accountLinked || prior?.accountLinked === true };
        }
      }
      return { state, value: undefined };
    });
  }

  async start(): Promise<TrialUi> {
    if (this.auth.snapshot().status !== "signed_out") throw new Error("Use your AgentLens account for new requests.");
    const state = await this.store.update(current => {
      const secret = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const next: StoredTrial = current ?? { version: 1, credential: secret(), pending: [], recent: {} };
      return { state: next, value: next };
    });
    if (this.auth.snapshot().status !== "signed_out") throw new Error("Use your AgentLens account for new requests.");
    return status(await this.storeExperience(await this.api.experience(state.credential)));
  }

  async link(): Promise<void> {
    const state = await this.store.read();
    if (!state?.experience) return;
    const token = await this.auth.accessToken();
    if (token) await this.storeExperience(await this.api.link(state.credential, token));
  }

  async fetch(input: TrialInput): Promise<FetchPage> {
    const selected = await this.store.update(current => {
      const state = required(current);
      if (state.experience?.mode !== "B") throw new Error("Sign in to parse your own links.");
      if (this.auth.snapshot().status !== "signed_out" || state.experience.trial?.accountLinked) {
        throw new Error("Sign in with the linked account to continue.");
      }
      const pending = state.pending.find(row => sameRequest(row.input, input));
      const intent = pending ?? { input, key: crypto.randomUUID() };
      if (!pending) state.pending.push(intent);
      return { state, value: { state, intent } };
    });
    return this.run(selected.state, selected.intent);
  }

  async recover(mode: TrialMode): Promise<{ url: string; page: FetchPage; pages: readonly FetchPage[] }> {
    const state = required(await this.store.read());
    const intent = [...state.pending].reverse().find(row => row.input.mode === mode) ?? state.recent[mode];
    if (!intent) throw new Error("There is no saved trial request for this workflow.");
    const epoch = this.auth.sessionEpoch();
    const token = await this.auth.accessToken() ?? undefined;
    if (epoch !== this.auth.sessionEpoch()) throw new Error("The account changed. Reopen the previous trial request.");
    if (token) await this.storeExperience(await this.api.link(state.credential, token));
    const page = await this.run(state, intent, token);
    const pages = [page];
    if (mode === "profile_page") {
      const previous = [...(state.profileHistory ?? [])].reverse();
      let cursor = intent.input.cursor;
      const seen = new Set([intent.key]);
      while (cursor) {
        const preceding = previous.find(row => row.input.url === intent.input.url && row.nextCursor === cursor && !seen.has(row.key));
        if (!preceding?.operationId) break;
        seen.add(preceding.key);
        const receipt = await this.api.recover(preceding.operationId, token ? { token } : { credential: state.credential });
        if (!receipt.page || receipt.page.page?.cursor !== cursor) break;
        pages.unshift(receipt.page);
        cursor = preceding.input.cursor;
      }
    }
    if (epoch !== this.auth.sessionEpoch()) throw new Error("The account changed. Reopen the previous trial request.");
    return { url: intent.input.url, page, pages };
  }

  async claimSavePrompt(): Promise<boolean> {
    return this.store.update(current => {
      const state = required(current);
      const show = !state.didShowSavePrompt;
      state.didShowSavePrompt = true;
      return { state, value: show };
    });
  }

  private async storeExperience(experience: TrialExperience): Promise<StoredTrial> {
    return this.store.update(current => {
      const state = required(current);
      if (state.experience && state.experience.enrollmentId !== experience.enrollmentId) {
        throw new Error("The trial assignment changed. Keep the original request for recovery.");
      }
      state.experience = experience;
      return { state, value: state };
    });
  }

  private async run(state: StoredTrial, intent: Intent, token?: string): Promise<FetchPage> {
    let reply: TrialReply;
    try {
      reply = intent.operationId
        ? await this.api.recover(intent.operationId, token ? { token } : { credential: state.credential })
        : await this.api.fetch(state.credential, intent.key, intent.input, token);
    } catch (error) {
      if (!intent.operationId && error instanceof AgentLensError && error.serverCode && new Set([
        "TRIAL_EXHAUSTED", "TRIAL_BUDGET_EXHAUSTED", "TRIAL_UNAVAILABLE", "MODE_MISMATCH", "INVALID_URL", "INVALID_REQUEST"
      ]).has(error.serverCode)) {
        await this.updateReply(intent);
      }
      throw error;
    }
    await this.updateReply(intent, reply);
    if (reply.page) return reply.page;
    const message = reply.status === "processing" ? "The original trial request is still processing. Retry it to check the result."
      : reply.status === "unknown" ? "The trial result is pending confirmation. Retry the original request."
      : reply.status === "delivery_pending" ? "Retrieval succeeded. Retry to recover the original result."
      : "The source could not be retrieved. No trial use was charged.";
    throw new Error(reply.errorCode && reply.status === "failed" ? `${message} (${reply.errorCode})` : message);
  }

  private async updateReply(intent: Intent, reply?: TrialReply): Promise<void> {
    await this.store.update(current => {
      const state = required(current);
      const terminal = !reply || reply.status === "failed" || reply.status === "success" || reply.status === "success_empty";
      if (reply && state.experience?.mode === "B") {
        const prior = state.experience.trial;
        if (!prior || reply.balance.settled >= prior.settled) {
          state.experience.trial = { ...reply.balance, accountLinked: reply.balance.accountLinked || prior?.accountLinked === true };
        }
      }
      const index = state.pending.findIndex(row => row.key === intent.key);
      if (terminal && index >= 0) state.pending.splice(index, 1);
      if (!terminal && index >= 0) state.pending[index] = { ...intent, operationId: reply.operationId };
      if (reply?.page && index >= 0) {
        const cursor = reply.page.page?.cursor;
        const recovered = { ...intent, operationId: reply.operationId, ...(cursor ? { nextCursor: cursor } : {}) };
        state.recent[intent.input.mode] = recovered;
        if (intent.input.mode === "profile_page") (state.profileHistory ??= []).push(recovered);
      }
      return { state, value: undefined };
    });
  }
}
