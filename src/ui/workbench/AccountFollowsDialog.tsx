import {usePendingFollowConfiguration} from "./usePendingFollowConfiguration";
import { useEffect, useRef, useState } from "react";
import type { AccountFollow } from "../../api/AgentLensApiClient";
import type { AutoFetchWorkbenchPort } from "../../workbench/ports";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { message } from "./shared";

export function AccountFollowsDialog({ service, onClose, onUnfollowed }: {
  service: AutoFetchWorkbenchPort; onClose: () => void; onUnfollowed?: (followId: string) => void;
}) {
  const pendingConfiguration = usePendingFollowConfiguration(service);
  const [follows, setFollows] = useState<readonly AccountFollow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState<AccountFollow | null>(null);
  const generation = useRef(0);
  const mutationInFlight = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    mutationInFlight.current = false;
    setPending(null);
    setBusy(true); setError(null); setFollows(null); setPage(0);
    void service.accountFollows().then(rows => { if (current === generation.current) setFollows(rows); }, reason => {
      if (current === generation.current) setError(message(reason, "read_only"));
    }).finally(() => { if (current === generation.current) setBusy(false); });
    return () => { generation.current++; };
  }, [service, attempt]);

  const priorPending = useRef(new Set<string>());
  useEffect(() => {
    const completed = [...priorPending.current].some(id => !pendingConfiguration.has(id));
    priorPending.current = pendingConfiguration;
    if (!completed || navigator.onLine === false) return;
    let active = true;
    const current = generation.current;
    void service.accountFollows().then(rows => {
      if (active && current === generation.current) {
        setFollows(rows);
        setPage(value => Math.min(value, Math.max(0, Math.ceil(rows.length / 25) - 1)));
      }
    }).catch(() => { /* Keep the last confirmed rows while offline. */ });
    return () => { active = false; };
  }, [service, pendingConfiguration]);

  async function confirmUnfollow() {
    if (!pending || mutationInFlight.current || busy) return;
    const selected = pending;
    const current = generation.current;
    mutationInFlight.current = true;
    setBusy(true); setError(null);
    try {
      if (service.queueFollowDeletion) {
        await service.queueFollowDeletion(selected.followId);
        return;
      }
      await service.unfollowAccount(selected.followId);
      if (current !== generation.current) return;
      setFollows(rows => rows?.filter(row => row.followId !== selected.followId) ?? null);
      setPage(value => Math.min(value, Math.max(0, Math.ceil(((follows?.length ?? 1) - 1) / 25) - 1)));
      onUnfollowed?.(selected.followId);
    } catch {
      if (current === generation.current) setError("We couldn’t confirm whether this creator was unfollowed. Refresh account follows before trying again.");
    } finally {
      if (current === generation.current) {
        setPending(null); setBusy(false); mutationInFlight.current = false;
      }
    }
  }
  return <WorkbenchDialog title="Account follows" onClose={onClose}>
    <p>Creators followed by your AgentLens account for this product. Saving destinations and progress are separate for each installation.</p>
    <p>Viewing this list does not link creators to this Vault or start checks.</p>
    {busy && <p role="status">{pending ? "Cancelling follow…" : "Loading account follows…"}</p>}
    {error && <p role="alert">{error}</p>}
    {pending && <section aria-label="Confirm account unfollow">
      <h3>Unfollow {pending.creator.displayName} for this product?</h3>
      <p>Future automatic checks will stop for this product. Saved files and task history will be kept.</p>
      <button type="button" disabled={busy} onClick={() => setPending(null)}>Keep following</button>
      <button type="button" disabled={busy} onClick={() => void confirmUnfollow()}>Confirm account unfollow</button>
    </section>}
    {follows?.length === 0 && <p>No account follows.</p>}
    {follows && follows.length > 0 && <>
      <p>{follows.length} account follows · Page {page + 1}</p>
      <ul aria-label="Account creators">{follows.slice(page * 25, (page + 1) * 25).map(follow => <li key={follow.followId}>
        <strong>{follow.creator.displayName}</strong><p>{follow.creator.platform}{follow.creator.handle ? ` · ${follow.creator.handle}` : ""}</p>
        <p>{pendingConfiguration.has(follow.followId) ? "Pending sync" : follow.autoFetchEnabled ? "Enabled" : "Paused"} · Every {follow.frequency.every} {follow.frequency.unit}(s)</p>
        <button type="button" disabled={busy || pendingConfiguration.has(follow.followId) || Boolean(error) || Boolean(pending)} onClick={() => setPending(follow)} aria-label={`Unfollow ${follow.creator.displayName} for this product`}>Unfollow</button>
      </li>)}</ul>
      <button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous creators</button>
      <button type="button" disabled={(page + 1) * 25 >= follows.length} onClick={() => setPage(value => value + 1)}>Next creators</button>
    </>}
    <button type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)}>{error ? "Retry account follows" : "Refresh account follows"}</button>
  </WorkbenchDialog>;
}
