import { FollowConfigurationOutbox } from "./FollowConfigurationOutbox";
import { validateFollowChanges } from "../api/followSync";
import { validateScheduleHistory, type ScheduleRevision } from "../api/scheduleHistory";
import type { AgentLensApiPort } from "../workbench/ports";
import type { PluginStateStore } from "./PluginStateStore";

export interface FollowSyncCheckpoint {
  after: number;
  through?: number;
  configurations: Record<string, ScheduleRevision>;
}

/** Configuration evidence only. Never writes scheduler watermarks, jobs, or delivery receipts. */
export class FollowConfigurationSync {
  constructor(private readonly api: AgentLensApiPort, private readonly store: PluginStateStore) {}

  async run(userId: string, token: string, current: () => Promise<boolean>): Promise<boolean> {
    if (!this.api.followChanges) return true; // Older embedded API adapters have no sync transport.
    const check = async () => { if (!await current()) throw new Error("Configuration session changed; retry with the current account."); };
    await check();
    await new FollowConfigurationOutbox(this.store).flush(this.api, userId, token, current);
    await check();
    const state = await this.store.load();
    const key = JSON.stringify([userId, state.installationId, "obsidian"]);
    const prior = state.followSync?.[key];
    const after = prior?.after ?? 0;
    const page = validateFollowChanges(await this.api.followChanges(token, after, prior?.through), after, prior?.through);
    await check();
    const configurations = { ...prior?.configurations };
    const revisions = new Map<string, number>();
    // Migration seeds only the latest event; the first pass always reads the authoritative list.
    if (!prior) {
      const follows = await this.api.accountFollows(token);
      await check();
      if (!Array.isArray(follows)) throw new Error("Invalid authoritative follow list.");
      for (const item of follows as unknown[]) {
        if (!item || typeof item !== "object") throw new Error("Invalid authoritative follow identity or revision.");
        const follow = item as Record<string, unknown>;
        if (!follow || typeof follow.followId !== "string" || !follow.followId.trim()
            || typeof follow.configRevision !== "number" || !Number.isSafeInteger(follow.configRevision) || follow.configRevision < 1 || revisions.has(follow.followId))
          throw new Error("Invalid authoritative follow identity or revision.");
        revisions.set(follow.followId, follow.configRevision);
      }
    }
    for (const change of page.changes)
      revisions.set(change.followId, Math.max(revisions.get(change.followId) ?? 0, change.configRevision));
    for (const [followId, through] of revisions) {
      if ((configurations[followId]?.revision ?? 0) >= through) continue;
      let cursor = 0;
      for (;;) {
        await check();
        const history = validateScheduleHistory(await this.api.scheduleHistory(token, followId, cursor, through), followId, cursor, through);
        await check();
        const latest = history.revisions.at(-1);
        if (latest) configurations[followId] = latest;
        if (history.nextAfterRevision === null) break;
        cursor = history.nextAfterRevision;
      }
    }
    await check();
    // Cursor and configuration snapshot commit together; failures replay the same event page.
    await this.store.update(value => {
      if (value.installationId !== state.installationId) throw new Error("Configuration installation changed.");
      const existing = value.followSync?.[key];
      if (JSON.stringify(existing) !== JSON.stringify(prior)) throw new Error("Configuration sync advanced concurrently; retry.");
      value.followSync ??= {};
      value.followSync[key] = { after: page.nextAfterEventId, configurations,
        ...(page.hasMore ? { through: page.throughEventId } : {}) };
    });
    await check();
    const committed = await this.store.load();
    if ((committed.followConfigurationOutbox ?? []).some(command => command.owner === userId && command.installationId === state.installationId && !command.resolution))
      throw new Error("Configuration changes arrived during synchronization; submit them before scheduling.");
    await check();
    return !page.hasMore;
  }
}
