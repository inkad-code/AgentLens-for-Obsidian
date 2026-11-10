import { AgentLensError } from "../core/errors";
import { validateScheduleHistory, type ScheduleRevision } from "../api/scheduleHistory";
import type { PluginStateStore } from "./PluginStateStore";
import type { AgentLensApiPort } from "../workbench/ports";

export interface FollowConfigurationPatch {
  configRevision: number;
  autoFetchEnabled?: boolean;
  frequency?: { every: number; unit: "minute" | "hour" | "day" | "week" };
}
interface FollowCommandIdentity {
  id: string;
  owner: string;
  installationId: string;
  followId: string;
  resolution?: { state: "superseded_by_deletion"; revision: number; effectiveAt: string };
}

export type FollowConfigurationCommand = FollowCommandIdentity & (
  { kind?: "patch"; patch: FollowConfigurationPatch } | { kind: "delete" }
);

/** Durable configuration commands only: no tokens, local execution state or optimistic revisions. */
export class FollowConfigurationOutbox {
  constructor(private readonly store: PluginStateStore, private readonly createId: () => string = () => crypto.randomUUID(), private readonly current: () => boolean = () => true) {}
  async enqueue(owner: string, followId: string, patch: FollowConfigurationPatch, exclusive = false): Promise<string> {
    validatePatch(patch);
    return this.append(owner, followId, { patch: structuredClone(patch) }, exclusive);
  }
  async enqueueDelete(owner: string, followId: string, exclusive = false): Promise<string> {
    return this.append(owner, followId, { kind: "delete" }, exclusive);
  }
  private async append(owner: string, followId: string, action: { patch: FollowConfigurationPatch } | { kind: "delete" }, exclusive = false): Promise<string> {
    if (!owner.trim() || !followId.trim()) throw new Error("Invalid follow identity.");
    const id = this.createId();
    if (!id.trim()) throw new Error("Invalid configuration command identity.");
    await this.store.update(state => {
      if (!this.current()) throw new Error("Configuration context changed.");
      state.followConfigurationOutbox ??= [];
      if (state.followConfigurationOutbox.some(command => command.id === id)) throw new Error("Duplicate configuration command identity.");
      if (state.followConfigurationOutbox.some(command => command.owner === owner && command.installationId === state.installationId
          && command.followId === followId && (exclusive || command.kind === "delete") && !command.resolution)) throw new Error(exclusive ? "Follow configuration is already pending." : "Follow deletion is already pending.");
      state.followConfigurationOutbox.push({ id, owner, installationId: state.installationId, followId, ...action });
    });
    return id;
  }
  async flush(api: AgentLensApiPort, owner: string, token: string, current: () => Promise<boolean>): Promise<void> {
    const state = await this.store.load();
    const queued = state.followConfigurationOutbox ?? [];
    if (!Array.isArray(queued)) throw new Error("Invalid retained configuration outbox.");
    const ids = new Set<string>();
    for (const c of queued) {
      if (!c || [c.id, c.owner, c.installationId, c.followId].some(v => typeof v !== "string" || !v.trim()) || ids.has(c.id))
        throw new Error("Invalid retained configuration identity.");
      if (c.resolution && (c.resolution.state !== "superseded_by_deletion" || !Number.isSafeInteger(c.resolution.revision)
          || c.resolution.revision < 1 || !c.resolution.effectiveAt.endsWith("Z") || !Number.isFinite(Date.parse(c.resolution.effectiveAt))))
        throw new Error("Invalid retained configuration resolution.");
      ids.add(c.id);
      if (c.kind === "delete") {
        if ("patch" in c) throw new Error("Invalid retained deletion command.");
      } else {
        if (c.kind !== undefined && c.kind !== "patch") throw new Error("Invalid retained configuration kind.");
        validatePatch(c.patch);
      }
    }
    const commands = queued.filter(c => c.owner === owner && c.installationId === state.installationId && !c.resolution);
    for (const command of commands) {
      if (!await current()) throw new Error("Configuration session changed.");
      let tombstone: ScheduleRevision | undefined;
      try {
        if (command.kind === "delete") {
          if (!api.deleteAccountFollowCommand) throw new Error("Configuration deletion is unavailable.");
          await api.deleteAccountFollowCommand(token, command.followId, command.id);
        } else {
          if (!api.patchAccountFollow) throw new Error("Configuration submission is unavailable.");
          await api.patchAccountFollow(token, command.followId, command.patch, command.id);
        }
      } catch (error) {
        if (!(error instanceof AgentLensError) || error.status !== 409 || error.serverCode !== "FOLLOW_DELETED") throw error;
        tombstone = await this.deletedRevision(api, token, command, current);
      }
      if (!await current()) throw new Error("Configuration session changed.");
      await this.store.update(value => {
        if (value.installationId !== state.installationId) throw new Error("Configuration installation changed.");
        const existing = value.followConfigurationOutbox?.find(c => c.id === command.id);
        if (JSON.stringify(existing) !== JSON.stringify(command)) throw new Error("Configuration command changed.");
        if (tombstone) existing!.resolution = { state: "superseded_by_deletion", revision: tombstone.revision, effectiveAt: tombstone.effectiveAt };
        else value.followConfigurationOutbox = value.followConfigurationOutbox!.filter(c => c.id !== command.id);
      });
    }
  }
  private async deletedRevision(api: AgentLensApiPort, token: string, command: FollowConfigurationCommand, current: () => Promise<boolean>): Promise<ScheduleRevision> {
    let after = 0; let through: number | undefined;
    for (;;) {
      if (!await current()) throw new Error("Configuration session changed.");
      const history = validateScheduleHistory(await api.scheduleHistory(token, command.followId, after, through), command.followId, after, through);
      if (!await current()) throw new Error("Configuration session changed.");
      through = history.throughRevision;
      if (history.nextAfterRevision === null) {
        const last = history.revisions.at(-1);
        if (!last?.deleted || last.legacySnapshot || (command.kind !== "delete" && last.revision < command.patch.configRevision))
          throw new Error("Follow deletion needs authoritative history before resolving the command.");
        return last;
      }
      after = history.nextAfterRevision;
    }
  }

}

function validatePatch(patch: FollowConfigurationPatch): void {
  if (!patch || !Number.isSafeInteger(patch.configRevision) || patch.configRevision < 1
      || Object.keys(patch).some(k => !["configRevision", "autoFetchEnabled", "frequency"].includes(k))
      || (patch.autoFetchEnabled !== undefined && typeof patch.autoFetchEnabled !== "boolean")
      || (patch.frequency !== undefined && (!patch.frequency || Object.keys(patch.frequency).some(k => !["every", "unit"].includes(k))
        || !Number.isSafeInteger(patch.frequency.every) || patch.frequency.every < 1 || !["minute", "hour", "day", "week"].includes(patch.frequency.unit)))
      || (patch.autoFetchEnabled === undefined && !patch.frequency)) throw new Error("Invalid follow configuration command.");
}
