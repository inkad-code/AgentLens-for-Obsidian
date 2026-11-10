import type { ScheduleRevision } from "../api/scheduleHistory";

/** Compact coverage: even years offline require ranges, never one object per missed slot. */
export interface SlotRange { revision: number; firstSlot: number; lastSlot: number }
const unitSeconds = { minute: 60, hour: 3600, day: 86400, week: 604800 } as const;

function timestamp(value: string): bigint {
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || !/Z$/.test(value)) throw new Error("A valid UTC schedule timestamp is required.");
  const fraction = /\.(\d+)Z$/.exec(value)?.[1] ?? "";
  if (fraction.length > 6) throw new Error("Schedule timestamp precision is unsupported.");
  return BigInt(millis) * BigInt(1000) + BigInt(fraction.padEnd(6, "0").slice(3));
}
export function compareUtcTime(left: string, right: string): number {
  const a = timestamp(left), b = timestamp(right);
  return a === b ? 0 : a < b ? -1 : 1;
}
export function utcMicrosKey(value: string): string { return timestamp(value).toString(); }
function floorDivide(value: bigint, divisor: bigint): bigint {
  const quotient = value / divisor;
  return value < BigInt(0) && value % divisor !== BigInt(0) ? quotient - BigInt(1) : quotient;
}
function interval(config: ScheduleRevision): bigint {
  const seconds = unitSeconds[config.frequencyUnit];
  if (!seconds || !Number.isSafeInteger(config.frequencyEvery) || config.frequencyEvery < 1)
    throw new Error("Invalid schedule frequency.");
  return BigInt(config.frequencyEvery) * BigInt(seconds) * BigInt(1000000);
}
function index(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("Schedule slot index is outside the supported range.");
  return result;
}
function format(value: bigint): string {
  const millis = floorDivide(value, BigInt(1000));
  const remainder = value - millis * BigInt(1000);
  const iso = new Date(Number(millis)).toISOString();
  return remainder ? iso.replace("Z", `${remainder.toString().padStart(3, "0")}Z`) : iso;
}

export function slotTime(config: ScheduleRevision, slot: number): string {
  if (!Number.isSafeInteger(slot) || slot < 0) throw new Error("Invalid schedule slot.");
  return format(timestamp(config.anchorAt) + BigInt(slot) * interval(config));
}

export function nextFixedSlot(config: ScheduleRevision, after: string): { slot: number; at: string } {
  const steps = floorDivide(timestamp(after) - timestamp(config.anchorAt), interval(config)) + BigInt(1);
  const slot = index(steps < BigInt(0) ? BigInt(0) : steps);
  return { slot, at: slotTime(config, slot) };
}

/**
 * history must start with the revision effective at fromExclusive, followed by
 * every accepted change up to throughInclusive. Missing history fails closed;
 * the caller keeps its durable recovery demand and watermark unchanged.
 */
export function uncoveredSlots(history: ScheduleRevision[], fromExclusive: string,
  throughInclusive: string, covered: SlotRange[]): SlotRange[] {
  const from = timestamp(fromExclusive), through = timestamp(throughInclusive);
  if (through < from) throw new Error("Schedule recovery range is reversed.");
  if (!history.length || timestamp(history[0]!.effectiveAt) > from)
    throw new Error("Schedule history does not cover the recovery boundary.");
  const result: SlotRange[] = [];
  for (let position = 0; position < history.length; position++) {
    const config = history[position]!, previous = history[position - 1], next = history[position + 1];
    const effective = timestamp(config.effectiveAt);
    const anchor = timestamp(config.anchorAt), period = interval(config);
    if (previous && (config.revision !== previous.revision + 1
        || effective < timestamp(previous.effectiveAt) || anchor !== timestamp(previous.anchorAt)))
      throw new Error("Schedule history is not contiguous or changed its anchor.");
    if (!config.autoFetchEnabled || config.deleted || effective > through) continue;
    const lower = from >= effective ? from + BigInt(1) : effective;
    const nextEffective = next ? timestamp(next.effectiveAt) : through + BigInt(1);
    const upper = nextEffective <= through ? nextEffective - BigInt(1) : through;
    const firstIndex = floorDivide(lower - anchor + period - BigInt(1), period);
    const first = index(firstIndex < BigInt(0) ? BigInt(0) : firstIndex);
    const last = index(floorDivide(upper - anchor, period));
    if (first > last) continue;
    let remaining: SlotRange[] = [{ revision: config.revision, firstSlot: first, lastSlot: last }];
    for (const claim of covered.filter(item => item.revision === config.revision)) {
      if (!Number.isSafeInteger(claim.firstSlot) || !Number.isSafeInteger(claim.lastSlot)
          || claim.firstSlot < 0 || claim.lastSlot < claim.firstSlot) throw new Error("Invalid persisted slot coverage.");
      remaining = remaining.flatMap(part => {
        if (claim.lastSlot < part.firstSlot || claim.firstSlot > part.lastSlot) return [part];
        const pieces: SlotRange[] = [];
        if (claim.firstSlot > part.firstSlot) pieces.push({ ...part, lastSlot: claim.firstSlot - 1 });
        if (claim.lastSlot < part.lastSlot) pieces.push({ ...part, firstSlot: claim.lastSlot + 1 });
        return pieces;
      });
    }
    result.push(...remaining);
  }
  return result;
}

/** A resume is an explicit scheduling boundary, not an offline recovery event. */
export function latestResumeAt(history: ScheduleRevision[]): string | undefined {
  for (let index = history.length - 1; index > 0; index--)
    if (history[index]!.autoFetchEnabled && !history[index - 1]!.autoFetchEnabled) return history[index]!.effectiveAt;
  return undefined;
}
