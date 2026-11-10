import addCreatorEmpty from "./assets/empty-state/add-creator-runtime.png";
import { EmptyStateIllustration } from "./EmptyStateIllustration";
import { usePendingFollowConfiguration } from "./usePendingFollowConfiguration";
import { isPinterestGuidance } from "../../core/pinterest-board";
import type { SyntheticEvent } from "react";
import { RemoteImage } from "./RemoteImage";
import { creatorFolderLink } from "./creatorAssets";
import { mediaControlStyle } from "./singleControlAssets";
import { ActionStateIcon } from "./ActionStateIcon";
import { TimezoneField, validTimezone } from "./TimezoneField";
import { VaultFolderPicker, VaultFoldersContext } from "./FolderField";
import { useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import type { AutoFetchWorkbenchPort } from "../../workbench/ports";
import type { MediaPolicy } from "../../core/domain";
import type { AutoFetchCapabilities, CreatorParseResult, CreatorRecord, FrequencyUnit } from "../../api/AgentLensApiClient";
import type { AccountCapabilities } from "../../api/contracts";
import type { TemplateId, WorkbenchDefaults } from "./types";
import { PlatformIcon, RemoteThumbnail, SupportedPlatforms, supportedPlatforms, message, operationAvailable } from "./shared";
import { redactPersistentUrl } from "../../core/urls";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { parsedCheck, frequencyCheck, scheduleChevron } from "./creatorAssets";
import { creatorStatus } from "./creatorStatusProjection";
import { CreatorStatus, CreatorBadge } from "./CreatorStatus";
import { useI18n } from "../../i18n/I18nProvider";
import { WorkflowOnboarding } from "./WorkflowOnboarding";
import { AutoFetchTasks, AutoFetchImportStatus, useImportTasks } from "./AutoFetchTasks";

export function AutoFetchPane({
  onOpenFolder,
  onRequestSignUp,
  onStartFree,
  service,
  signedIn,
  capabilities,
  capabilitiesError = false,
  defaults,
  onDraftChange,
  onAccountChanged,
  removedFollowId,
  statusError
}: {
  statusError?: string | null | undefined;
  removedFollowId?: string | undefined;
  onOpenFolder?: ((path: string) => void) | undefined;
  service?: AutoFetchWorkbenchPort | undefined;
  signedIn: boolean;
  onRequestSignUp?: (()=>void) | undefined;
  onStartFree?: (()=>void) | undefined;
  capabilities: AccountCapabilities | null;
  capabilitiesError?: boolean | undefined;
  defaults: WorkbenchDefaults;
  onDraftChange: (dirty: boolean) => void;
  onAccountChanged?: (() => void) | undefined;
}) {
  const { t } = useI18n();
  const pendingConfiguration = usePendingFollowConfiguration(service, capabilities?.accountId);
  const viewGeneration = useRef(0);
  const creatorChanges = useRef(0);
  const activeCreatorChanges = useRef(0);
  const creatorReadSequence = useRef(0);
  function beginCreatorChange() {
    const current = captureView();
    creatorChanges.current += 1;
    activeCreatorChanges.current += 1;
    return () => {
      if (!current()) return;
      creatorChanges.current += 1;
      activeCreatorChanges.current -= 1;
    };
  }
  async function readCreatorSetup() {
    if (!service) return undefined;
    const current = captureView(), changes = creatorChanges.current, sequence = ++creatorReadSequence.current;
    const canPublish = () => current() && changes === creatorChanges.current
      && sequence === creatorReadSequence.current && activeCreatorChanges.current === 0;
    try {
      const setup = await service.autoFetchSetup();
      return canPublish() ? setup : undefined;
    } catch (error) {
      if (canPublish()) throw error;
      return undefined;
    }
  }
  function captureView() {
    const generation = viewGeneration.current;
    return () => generation === viewGeneration.current;
  }
  const [, updateActivity] = useState(0);
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
  const [toggling, setToggling] = useState<ReadonlySet<string>>(new Set());
  const vault = useContext(VaultFoldersContext);
  const creatorResultsRef = useRef<HTMLDivElement>(null);
  const profileInputRef = useRef<HTMLInputElement>(null);
  const taskHistory = useImportTasks(service, signedIn, capabilities?.accountId);
  const [showTasks, setShowTasks] = useState(false);
  const [adding, setAdding] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [timezone, setTimezone] = useState(detectedTimezone);
  const [homeTimezoneConfirmed, setHomeTimezoneConfirmed] = useState(false);
  const [profileUrl, setProfileUrl] = useState("");
  const [folderPath, setFolderPath] = useState(defaults.folderPath);
  const [autoFetchCapabilities, setAutoFetchCapabilities] = useState<AutoFetchCapabilities | null>(null);
  const [every, setEvery] = useState(() => clampEvery(defaults.autoEvery, defaults.autoUnit));
  const [unit, setUnit] = useState<FrequencyUnit>(defaults.autoUnit);
  const [preferredTime, setPreferredTime] = useState(defaults.autoPreferredTime);
  const [noteTemplateId, setNoteTemplateId] = useState<TemplateId>(defaults.templateId);
  const [mediaPolicy, setMediaPolicy] = useState<MediaPolicy>(defaults.mediaPolicy);
  const [parsed, setParsed] = useState<CreatorParseResult | null>(null);
  const [setupStatus, setSetupStatus] = useState<"loading" | "ready" | "error">("loading");
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [creators, setCreators] = useState<readonly CreatorRecord[]>([]);
  const creatorsRef = useRef(creators);
  creatorsRef.current = creators;
  useEffect(() => {
    if (!service || !signedIn) return;
    let active = true, timer: number | undefined;
    const refresh = () => {
      timer = undefined;
      const previous = creatorsRef.current;
      void service.refreshAutoFetchCreators?.(previous).then(projected => {
        if (active) setCreators(current => current === previous ? projected : current);
      }).catch(() => { /* A changed session must not publish old task facts. */ });
    };
    const unsubscribe = service.subscribeAutoFetchActivity?.(() => {
      updateActivity(value => value + 1);
      if (!timer) timer = window.setTimeout(refresh, 100);
    });
    return () => { active = false; if (timer) window.clearTimeout(timer); unsubscribe?.(); };
  }, [service, signedIn, capabilities?.accountId]);
  const priorPending = useRef(new Set<string>());
  useEffect(() => {
    const completed = [...priorPending.current].some(id => !pendingConfiguration.has(id));
    priorPending.current = pendingConfiguration;
    if (!completed || !service || !signedIn || navigator.onLine === false) return;
    let active = true;
    void readCreatorSetup().then(setup => {if (active && setup) setCreators(setup.creators);}).catch(() => {});
    return () => {active = false;};
  }, [pendingConfiguration]);
  const [creatorSearch, setCreatorSearch] = useState("");
  const [creatorPlatform, setCreatorPlatform] = useState("all");
  const [creatorState, setCreatorState] = useState("all");
  const filterPlatforms = supportedPlatforms(signedIn ? capabilities : null, "autoFetch");
  const effectivePlatform = filterPlatforms.some(platform => platform.id === creatorPlatform) ? creatorPlatform : "all";
  useEffect(() => {
    if (effectivePlatform !== creatorPlatform) setCreatorPlatform("all");
  }, [effectivePlatform, creatorPlatform]);
  const visibleCreators = creators.filter((creator) => {
    const matchesText = `${creator.displayName} ${creator.platform} ${creator.handle ?? ""} ${creator.profileUrl} ${creator.saveFolderPath}`.toLocaleLowerCase().includes(creatorSearch.trim().toLocaleLowerCase());
    const status = creatorStatus(creator, service?.autoFetchActivity?.(creator.creatorId, creator.saveFolderPath));
    const needsAttention = status.mainStatus === "failed"
      || ["retry_pending", "verifying_write", "verifying_source", "receipt_pending"].includes(status.subStatus);
    return matchesText && (effectivePlatform === "all" || creator.platform === effectivePlatform)
      && (creatorState === "all" || (creatorState === "enabled" && creator.autoFetchEnabled)
        || (creatorState === "paused" && !creator.autoFetchEnabled) || (creatorState === "attention" && needsAttention));
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<CreatorRecord | null>(null);
  const restoreAddDraft = useRef<(() => void) | null>(null);
  const setupCreator = editing ?? parsed?.creator;
  const maximumEvery = maximumFrequencyEvery(unit, autoFetchCapabilities?.minuteFrequencyMaxEvery);
  const hasExistingFrequency = editing?.frequency.unit === unit && editing.frequency.every === every && every > maximumEvery;
  const settingsDraftRevision = useRef(0);
  const profileDraftRevision = useRef(0);

  useEffect(() => {
    if (!removedFollowId) return;
    creatorChanges.current += 1;
    setCreators(current => current.filter(creator => creator.followId !== removedFollowId));
  }, [removedFollowId]);

  useEffect(() => onDraftChange(Boolean(parsed || editing)), [parsed, editing, onDraftChange]);

  useEffect(() => {
    viewGeneration.current += 1;
    creatorChanges.current = 0; activeCreatorChanges.current = 0; creatorReadSequence.current = 0;
    profileDraftRevision.current += 1;
    settingsDraftRevision.current += 1;
    restoreAddDraft.current = null;
    setParsed(null); setEditing(null); setAdding(false); setShowTasks(false);
    setProfileUrl(""); setPendingDelete(null); setSyncResult(null);
    setCreatorPlatform("all");
    setTimezone(detectedTimezone); setHomeTimezoneConfirmed(false);
    setFolderPath(defaults.folderPath); setNoteTemplateId(defaults.templateId); setMediaPolicy(defaults.mediaPolicy);
    setEvery(defaults.autoEvery); setUnit(defaults.autoUnit); setPreferredTime(defaults.autoPreferredTime);
    setChecking(new Set()); setToggling(new Set()); setBusy(false);
    setAutoFetchCapabilities(null);
    setCreators([]);
    setSetupStatus("loading");
    setError(null);
    if (!service || !signedIn || !capabilities?.accountId) return () => { viewGeneration.current += 1; };
    let active = true;
    setBusy(true);
    void service.autoFetchSetup().then(
      (setup) => {
        if (!active) return;
        setCreators(setup.creators);
        setSetupStatus("ready");
        setAutoFetchCapabilities(setup.autoFetchCapabilities ?? null);
        if (setup.settings.homeTimezone) setTimezone(setup.settings.homeTimezone);
        setHomeTimezoneConfirmed(setup.settings.confirmed);
      },
      (caught) => { if (active) { setSetupStatus("error"); setError(message(caught, "read_only")); } }
    ).finally(() => active && setBusy(false));
    return () => { active = false; viewGeneration.current += 1; };
  }, [service, signedIn, capabilities?.accountId, setupAttempt]);


  async function refreshCreators() {
    const isCurrentView = captureView();
    if (!service) return;
    setBusy(true);
    setError(null);
    try {
      const setup = await readCreatorSetup();
      if (!isCurrentView() || !setup) return;
      setCreators(setup.creators);
        setAutoFetchCapabilities(setup.autoFetchCapabilities ?? null);
      setHomeTimezoneConfirmed(setup.settings.confirmed);
    } catch (caught) {
      if (!isCurrentView()) return;
      setError(message(caught, "read_only"));
    } finally {
      if (isCurrentView()) {
      setBusy(false);
      }
    }
  }

  async function ensureHomeTimezoneConfirmed() {
    if (!service || homeTimezoneConfirmed) return;
    const isCurrentView = captureView();
    await service.confirmTimezone(timezone);
    if (isCurrentView()) setHomeTimezoneConfirmed(true);
  }

  async function parseProfile(event: SyntheticEvent) {
    const isCurrentView = captureView();

    event.preventDefault();
    if (!service) return;
    const revision = profileDraftRevision.current;
    const requestedUrl = profileUrl.trim();
    setParsed(null);
    setBusy(true);
    setError(null);
    try {
      const result = await service.parseCreator(requestedUrl);
      if (!isCurrentView()) return;
      if (revision === profileDraftRevision.current) setParsed(result);
    } catch (caught) {
      if (!isCurrentView()) return;
      if (revision === profileDraftRevision.current) setError(message(caught));
    } finally {
      if (isCurrentView()) {
      if (revision === profileDraftRevision.current) setBusy(false);
      }
    }
  }

  function clearProfileUrl() {
    profileDraftRevision.current += 1;
    setProfileUrl("");
    setParsed(null);
    setError(null);
    setBusy(false);
    profileInputRef.current?.focus();
  }

  function validateFrequency() {
    if (unit !== "minute") return;
    if (!autoFetchCapabilities?.minuteFrequencyAvailable) throw new Error("Minute frequency is not available for this account.");
    if (!Number.isInteger(every) || every < 1 || every > autoFetchCapabilities.minuteFrequencyMaxEvery) {
      throw new Error("Select a supported minute frequency.");
    }
    if (editing?.frequency.unit !== "minute" && autoFetchCapabilities.minuteCreatorUsed >= autoFetchCapabilities.minuteCreatorLimit) {
      throw new Error("The account has reached its minute-frequency creator limit.");
    }
  }

  async function follow() {
    const revision = profileDraftRevision.current;
    const isCurrentView = captureView();
    if (!service || !parsed || !validTimezone(timezone)) return;
    const finishChange = beginCreatorChange();

    setBusy(true);
    setError(null);
    try {
      validateFrequency();
      await ensureHomeTimezoneConfirmed();
      if (revision !== profileDraftRevision.current) return;
      const creator = await service.followCreator({
        parsed,
        saveFolderPath: folderPath,
        timezone,
        every,
        unit,
        preferredTimes: every === 1 && unit === "day" && preferredTime ? [preferredTime] : [],
        noteTemplateId,
        mediaPolicy
      });
      if (!isCurrentView()) return;
      setCreators((current) => [creator, ...current.filter((item) => item.creatorId !== creator.creatorId)]);
      setParsed(null);
      setProfileUrl("");
      setAdding(false);
      setSetupStep(0);
    } catch (caught) {
      if (!isCurrentView()) return;
      setError(message(caught));
    } finally {
      finishChange();
      if (isCurrentView()) {
      if (signedIn) onAccountChanged?.();
      setBusy(false);
      }
    }
  }

  async function toggleCreator(creator: CreatorRecord) {
    const isCurrentView = captureView();
    if (!service || toggling.has(creator.creatorId) || pendingConfiguration.has(creator.followId ?? "")) return;
    const finishChange = beginCreatorChange();
    setToggling(current => new Set(current).add(creator.creatorId));
    try {
      if (creator.followId && creator.configRevision && service.queueFollowConfiguration) {
        await service.queueFollowConfiguration(creator.followId, {configRevision: creator.configRevision, autoFetchEnabled: !creator.autoFetchEnabled});
        return;
      }
      const updated = await service.setCreatorEnabled(creator.creatorId, !creator.autoFetchEnabled);
      if (!isCurrentView()) return;
      setCreators((current) => current.map((item) => item.creatorId === updated.creatorId && (item.configRevision ?? 0) <= (updated.configRevision ?? 0) ? updated : item));
    } catch (caught) {
      if (!isCurrentView()) return;
      setError(message(caught));
    } finally {
      finishChange();
      if (isCurrentView()) {
      setToggling(current => { const next = new Set(current); next.delete(creator.creatorId); return next; });
      }
    }
  }

  async function syncNow() {
    const isCurrentView = captureView();
    if (!service) return;
    setBusy(true);
    setError(null);
    try {
      const result = await service.runScheduled("manual_sync");
      if (!isCurrentView()) return;
      setSyncResult(`${result.leases} creator check(s), ${result.saved} saved, ${result.failed} failed.${result.deferred ? ` ${result.deferred} waiting for another check.` : ""}${result.terminated ? ` ${result.terminated} check(s) ended unsuccessfully.` : ""}`);
      const setup = await readCreatorSetup();
      if (!isCurrentView() || !setup) return;
      setCreators(setup.creators);
        setAutoFetchCapabilities(setup.autoFetchCapabilities ?? null);
    } catch (caught) {
      if (!isCurrentView()) return;
      setError(message(caught));
    } finally {
      if (isCurrentView()) {
      if (signedIn) onAccountChanged?.();
      setBusy(false);
      }
    }
  }

  async function checkCreatorNow(creator: CreatorRecord) {
    const isCurrentView = captureView();
    if (!service || checking.has(creator.creatorId)) return;
    setChecking(current => new Set(current).add(creator.creatorId));
    setError(null);
    try {
      const result = await service.runCreatorNow(creator);
      if (!isCurrentView()) return;

      setSyncResult(`${creator.displayName}: ${result.saved} saved, ${result.failed} failed.${result.deferred ? ` ${result.deferred} waiting for another check.` : ""}${result.terminated ? ` ${result.terminated} check(s) ended unsuccessfully.` : ""}`);
      const setup = await readCreatorSetup();
      if (!isCurrentView() || !setup) return;
      setCreators(setup.creators);
        setAutoFetchCapabilities(setup.autoFetchCapabilities ?? null);
    } catch (caught) {
      if (!isCurrentView()) return;
      setError(message(caught));
    } finally {
      if (isCurrentView()) {
      if (signedIn) onAccountChanged?.();
      setChecking(current => { const next = new Set(current); next.delete(creator.creatorId); return next; });
      }
    }
  }

  async function deleteCreator(creator: CreatorRecord) {
    const isCurrentView = captureView();
    if (!service) return;
    if (pendingDelete !== creator.creatorId) {
      setPendingDelete(creator.creatorId);
      return;
    }
    const finishChange = beginCreatorChange();
    setBusy(true);
    setError(null);
    try {
      if (creator.followId && service.queueFollowDeletion) {
        await service.queueFollowDeletion(creator.followId);
        if (isCurrentView()) {setPendingDelete(null); if (editing?.creatorId === creator.creatorId) closeSetup();}
        return;
      }
      await service.deleteCreator(creator.creatorId);
      if (!isCurrentView()) return;
      setCreators((current) => current.filter((item) => item.creatorId !== creator.creatorId));
      setPendingDelete(null);
      if (editing?.creatorId === creator.creatorId) closeSetup();
    } catch (caught) {
      if (!isCurrentView()) return;
      setError(message(caught));
    } finally {
      finishChange();
      if (isCurrentView()) {
      setBusy(false);
      }
    }
  }

  function closeSetup() {
    settingsDraftRevision.current += 1;
    profileDraftRevision.current += 1;
    setAdding(false);
    setEditing(null);
    setPendingDelete(null);

    setError(null);
    if (restoreAddDraft.current) { restoreAddDraft.current(); restoreAddDraft.current = null; }
    else setParsed(null);
  }

  function beginEdit(creator: CreatorRecord) {
    restoreAddDraft.current = () => {
      setFolderPath(folderPath); setTimezone(timezone); setEvery(every); setUnit(unit);
      setPreferredTime(preferredTime); setNoteTemplateId(noteTemplateId); setMediaPolicy(mediaPolicy);
      setProfileUrl(profileUrl); setParsed(parsed);
    };
    setPendingDelete(null); setAdding(true); setSetupStep(1); setProfileUrl(creator.profileUrl); setError(null);
    settingsDraftRevision.current += 1;
    setEditing(creator);
    setFolderPath(creator.saveFolderPath);
    setTimezone(creator.timezone);
    setEvery(creator.frequency.every);
    setUnit(creator.frequency.unit);
    setPreferredTime(creator.preferredTimes[0] ?? "");
    setNoteTemplateId(creator.noteTemplateId);
    setMediaPolicy(creator.mediaPolicy);

  }

  function invalidateSettingsDraft() {
    settingsDraftRevision.current += 1;

  }

  async function applySettings() {
    const isCurrentView = captureView();
    if (!service || !editing || busy) return;
    const finishChange = beginCreatorChange();
    const revision = settingsDraftRevision.current;
    const changes = { saveFolderPath: folderPath, timezone, every, unit,
      preferredTimes: every === 1 && unit === "day" && preferredTime ? [preferredTime] : [],
      noteTemplateId, mediaPolicy };
    setBusy(true); setError(null);
    try {
      validateFrequency();
      if (editing.followId && editing.configRevision && service.queueFollowConfiguration
        && folderPath === editing.saveFolderPath && timezone === editing.timezone && noteTemplateId === editing.noteTemplateId
        && mediaPolicy === editing.mediaPolicy && !changes.preferredTimes.length && !editing.preferredTimes.length) {
        await service.queueFollowConfiguration(editing.followId, {configRevision: editing.configRevision, frequency: {every, unit}});
        if (isCurrentView()) closeSetup();
        return;
      }
      if (navigator.onLine === false) throw new Error("Connect to save folder, template, media policy or timezone changes together.");
      await ensureHomeTimezoneConfirmed();
      if (!isCurrentView() || revision !== settingsDraftRevision.current) return;
      const preview = await service.previewCreatorSettings(editing.creatorId, changes);
      if (!isCurrentView() || revision !== settingsDraftRevision.current) return;
      const updated = await service.updateCreatorSettings(editing.creatorId, changes, preview.previewToken);
      if (!isCurrentView()) return;
      setCreators(current => current.map(item => item.creatorId === updated.creatorId && (item.configRevision ?? 0) <= (updated.configRevision ?? 0) ? updated : item));
      closeSetup();
    } catch (caught) {
      if (isCurrentView() && revision === settingsDraftRevision.current) setError(message(caught));
    } finally { finishChange(); if (isCurrentView()) setBusy(false); }
  }



  if (showTasks && signedIn) return <AutoFetchTasks tasks={taskHistory.tasks} loading={taskHistory.loading} error={taskHistory.error} service={service} onBack={() => setShowTasks(false)} onRefresh={taskHistory.refresh} />;

  return (
    <div className={`agentlens-pane agentlens-auto-pane${signedIn && setupStatus === "ready" && creators.length === 0 ? " has-empty-creators" : ""}`}>
      <div className="agentlens-pane__intro">
        <p className="agentlens-eyebrow">CREATOR UPDATES, SAVED TO Obsidian</p>
        <h2>Auto-Fetch</h2>
        <p>Follow creators and automatically check for and import new posts on schedule.</p>
      </div>
      <SupportedPlatforms capabilities={capabilities} catalogError={capabilitiesError} mode="autoFetch" />
      {!signedIn ? (
        <WorkflowOnboarding variant="auto" onRequestSignUp={onStartFree ?? onRequestSignUp} />
) : (
        <div className="agentlens-auto-layout">
          <button type="button" className="mod-cta agentlens-add-creator" onClick={() => { setAdding(true); setSetupStep(0); }} disabled={busy || setupStatus !== "ready"}>+ Add creator</button>
          <AutoFetchImportStatus tasks={taskHistory.tasks} loading={taskHistory.loading} error={taskHistory.error} onClick={() => setShowTasks(true)} />
          {adding && <WorkbenchDialog textClose className={`agentlens-creator-dialog step-${setupStep}${setupStep === 0 && error ? " has-parse-error" : ""}`} title="Auto-Fetch New Posts" onClose={() => { if (!busy) closeSetup(); }}>
          <p>Add a creator once, and new posts will be automatically synced to Obsidian.</p>
          <ol className="agentlens-setup-steps">{["Creator Profile", "Save Location", "Check Schedule"].map((step, index) => <li key={step} className={index < setupStep ? "is-completed" : undefined} aria-current={setupStep === index ? "step" : undefined}><span>{index < setupStep ? "✓" : index + 1}</span><div>{step}<small>{["Paste and parse link", "Select folder and path", "Set update schedule"][index]}</small></div></li>)}</ol>
          <section className={`agentlens-setup-content${setupStep === 0 && !setupCreator ? " has-empty-creator" : ""}`} aria-label={editing ? `Edit ${editing.displayName}` : undefined} onChangeCapture={() => { if (editing) invalidateSettingsDraft(); }}>
          {setupStep === 0 && <form className="agentlens-follow-form agentlens-setup-url" onSubmit={(event) => void parseProfile(event)}>
            <label htmlFor="agentlens-auto-url">Creator profile URL</label><div className="agentlens-url-bar"><input ref={profileInputRef} id="agentlens-auto-url" readOnly={Boolean(editing)} aria-label="Creator profile URL" placeholder="Paste a creator profile URL…" type="url" value={profileUrl} onChange={(event) => { profileDraftRevision.current += 1; setProfileUrl(event.currentTarget.value); setParsed(null); setError(null); setBusy(false); }} />
            {!editing && profileUrl && <button type="button" className="agentlens-clear-input" aria-label="Clear creator profile URL" onClick={clearProfileUrl}>×</button>}
            <button type="submit" className="mod-cta" disabled={Boolean(editing) || busy || !profileUrl.trim() || !operationAvailable(capabilities, "autoFetch", service?.clientVersion())} aria-label="Parse creator">Parse</button></div>
          </form>}
          {setupCreator && <section className="agentlens-follow-confirm">
            <div hidden={setupStep !== 0} className="agentlens-parsed-creator">
              <RemoteThumbnail url={setupCreator.avatarUrl ?? undefined} kind="Creator" />
              <div><h3>{setupCreator.displayName}</h3><p><PlatformIcon variant="creator" id={setupCreator.platform} /><span>{setupCreator.handle ? `@${setupCreator.handle.replace(/^@/, '')}` : setupCreator.profileUrl}</span></p></div>
              <span className="agentlens-parse-success"><img src={parsedCheck} width="18" height="18" alt="" />{editing ? "Creator profile" : "Parsed successfully"}</span>
            </div>
            {editing && setupStep === 1 && redactPersistentUrl(editing.profileUrl) && <a href={redactPersistentUrl(editing.profileUrl)} target="_blank" rel="noreferrer">{t("creator.openProfile")}</a>}
            <div hidden={setupStep !== 1} className="agentlens-setup-destination">
              <VaultFolderPicker value={folderPath} onChange={path => { setFolderPath(path); if (editing) invalidateSettingsDraft(); }} />
              <div className="agentlens-destination-options" style={mediaControlStyle}><label>Template<select aria-label="Note template" value={noteTemplateId} onChange={event => setNoteTemplateId(event.currentTarget.value as TemplateId)}><option value="default">Default template</option></select></label>
                <fieldset><legend>Media attachments</legend><div>{(['download_all','link_only',...(mediaPolicy === 'download_images_only' ? ['download_images_only'] : [])] as MediaPolicy[]).map(policy => <label className={mediaPolicy===policy ? 'is-selected' : ''} key={policy}><input type="radio" name="creator-media" value={policy} checked={mediaPolicy===policy} onChange={() => setMediaPolicy(policy)} />{policy==='download_all' ? 'Download available' : policy==='link_only' ? 'Link only' : 'Images only'}</label>)}</div></fieldset>
              </div>
              <label className="agentlens-destination-path">SAVE TO<input aria-label="Destination folder" value={folderPath} onChange={event => setFolderPath(event.currentTarget.value)} /></label>
            </div>
            <div hidden={setupStep !== 2} className="agentlens-schedule-settings" style={{"--agentlens-schedule-chevron": `url("${scheduleChevron}")`} as CSSProperties}>
              <fieldset className="agentlens-frequency-presets"><legend>FREQUENCY</legend><div>{([{label:'Every 1 hour',every:1,unit:'hour'},{label:'Every 2 hours',every:2,unit:'hour'},{label:'Every 4 hours',every:4,unit:'hour'},{label:'Daily',every:1,unit:'day'},{label:'Weekly',every:1,unit:'week'}] as const).map(preset => <button key={preset.label} type="button" aria-pressed={unit===preset.unit && (preset.unit==='week' || every===preset.every)} onClick={()=>{setEvery(preset.every);setUnit(preset.unit);if (editing) invalidateSettingsDraft();}}>{unit===preset.unit && (preset.unit==='week' || every===preset.every) && <img src={frequencyCheck} width="9" height="7" alt="" />}{preset.label}</button>)}</div></fieldset>
              <div className="agentlens-schedule-every"><span>EVERY</span><div><select aria-label="Frequency" value={every} onChange={event=>{setEvery(Number(event.currentTarget.value));if(editing) invalidateSettingsDraft();}}>{hasExistingFrequency && <option value={every} disabled>{every} (current)</option>}{Array.from({length: maximumEvery}, (_, index) => <option key={index+1} value={index+1}>{index+1}</option>)}</select><select aria-label="Unit" value={unit} onChange={event=>{const next=event.currentTarget.value as FrequencyUnit;setUnit(next);setEvery(current=>clampEvery(current,next,autoFetchCapabilities?.minuteFrequencyMaxEvery));if(editing) invalidateSettingsDraft();}}>{(autoFetchCapabilities?.minuteFrequencyAvailable || unit === "minute") && <option value="minute" disabled={!autoFetchCapabilities?.minuteFrequencyAvailable}>Minutes</option>}<option value="hour">Hours</option><option value="day">Days</option><option value="week">Weeks</option></select></div></div>
              {every===1 && unit==='day' && <label className="agentlens-schedule-time">Daily time<input type="time" value={preferredTime} onChange={event=>setPreferredTime(event.currentTarget.value)} /></label>}
              <TimezoneField value={timezone} onChange={zone => { setTimezone(zone); if (editing) invalidateSettingsDraft(); }} chevron={scheduleChevron} />
              <div className="agentlens-schedule-summary"><dl><div><dt>VAULT</dt><dd>{vault.name}</dd></div><div><dt>SAVE TO</dt><dd>{folderPath}</dd></div><div><dt>TEMPLATE</dt><dd>{noteTemplateId === "compact" ? "Compact template" : "Default template"}</dd></div><div><dt>MEDIA ATTACHMENTS</dt><dd>{mediaPolicy==='download_all'?'Download available':mediaPolicy==='link_only'?'Link only':'Images only'}</dd></div></dl>
                <div className="agentlens-schedule-creator"><RemoteThumbnail url={setupCreator.avatarUrl ?? undefined} kind="Creator" /><strong title={setupCreator.displayName}>{setupCreator.displayName}</strong><span className="agentlens-schedule-creator-handle"><PlatformIcon variant="creator" id={setupCreator.platform} />{setupCreator.handle ? `@${setupCreator.handle.replace(/^@/,'')}` : setupCreator.profileUrl}</span></div>
                <p className="agentlens-parse-error">Note: After following, only new posts from this point forward will be imported. Historical posts will not be fetched. Each update check may consume one fetch quota.</p>
              </div>
            </div>
          </section>}
          {error && <p className={setupStep === 0 ? "agentlens-parse-error" : "agentlens-inline-error"} data-pinterest-guidance={isPinterestGuidance(error) || undefined} role="alert">{error}</p>}
          {setupStep === 0 && !setupCreator && <div className="agentlens-add-creator-empty" aria-hidden="true"><img src={addCreatorEmpty} alt="" width={132} height={138} /></div>}
          </section>
          <footer className="agentlens-dialog-actions">
            {(editing || setupStep === 1) && <button type="button" className="agentlens-remove-draft" disabled={busy || !!editing && pendingConfiguration.has(editing.followId ?? "")} onClick={() => { if (editing) { void deleteCreator(editing); return; } profileDraftRevision.current += 1; setParsed(null); setProfileUrl(""); setSetupStep(0); }}>Remove</button>}
            {(!editing || setupStep === 2) && <button type="button" disabled={busy} onClick={() => { if (setupStep > 0) { setSetupStep(setupStep - 1); } else closeSetup(); }}>{setupStep > 0 ? "Back" : "Cancel"}</button>}
            {setupStep < 2 ? <button type="button" className="mod-cta" disabled={busy || (setupStep === 1 && !folderPath.trim())} onClick={() => { if (!setupCreator) { setError(current => current ?? "Parse a creator profile before continuing."); profileInputRef.current?.focus(); return; } setSetupStep(setupStep + 1); }}>Continue</button> : <button type="button" className="mod-cta" onClick={() => void (editing ? applySettings() : follow())} aria-label={editing ? "Save" : "Follow creator"} disabled={busy || !!editing && pendingConfiguration.has(editing.followId ?? "") || !folderPath.trim() || !validTimezone(timezone)}>{editing ? busy ? "Saving…" : "Save" : "Continue"}</button>}
          </footer>
          </WorkbenchDialog>}
          {pendingDelete && <WorkbenchDialog compact title="Remove this creator from Auto-Fetch?" className="agentlens-remove-dialog" onClose={() => {if (!busy) setPendingDelete(null);}}>
            <p>This removes the creator from the follow list and stops automatic checks and downloads. Existing Obsidian files and AgentLens history will be retained.</p>
            {error && <p role="alert" className="agentlens-inline-error">{error}</p>}
            <footer className="agentlens-dialog-actions"><button type="button" onClick={() => setPendingDelete(null)} disabled={busy}>Cancel</button><button type="button" className="agentlens-remove-draft" onClick={() => {const creator = creators.find(item => item.creatorId === pendingDelete); if (creator) void deleteCreator(creator);}} disabled={busy}>Remove</button></footer>
          </WorkbenchDialog>}
          <section className="agentlens-creator-list" aria-label="Followed creators">
            <div className="agentlens-url-bar agentlens-creator-search">              <input type="search" aria-label={t("creator.search")} placeholder="Search creator or platform" value={creatorSearch} onChange={(event) => setCreatorSearch(event.currentTarget.value)} />{creatorSearch && <button type="button" className="agentlens-clear-input" aria-label="Clear creator search" onClick={() => setCreatorSearch("")}>×</button>}<button type="button" className="mod-cta" onClick={() => creatorResultsRef.current?.focus()}>Search</button></div>
            {statusError && <p className="agentlens-inline-error" role="alert">{statusError}</p>}
            <details className="agentlens-creator-tools"><summary>Filters &amp; sync{setupStatus === "ready" && <> · {creators.length} creators</>}</summary><p>Checks run only while Obsidian is active and online. Sync checks due creators without changing their schedule.</p><button type="button" onClick={() => void syncNow()} disabled={busy}>Sync due creators</button>
            <div className="agentlens-bulk-filters" aria-label={t("creator.search")}>

              <label>{t("creator.filterPlatform")}<select value={effectivePlatform} onChange={(event) => setCreatorPlatform(event.currentTarget.value)}><option value="all">{t("creator.allPlatforms")}</option>{filterPlatforms.map((platform) => <option key={platform.id} value={platform.id}>{platform.label}</option>)}</select></label>
              <label>{t("creator.filterState")}<select value={creatorState} onChange={(event) => setCreatorState(event.currentTarget.value)}><option value="all">{t("creator.allStates")}</option><option value="enabled">{t("creator.enabled")}</option><option value="paused">{t("creator.paused")}</option><option value="attention">{t("creator.needsAttention")}</option></select></label>
              <button type="button" onClick={() => void refreshCreators()} disabled={busy}>{t("creator.refresh")}</button>
            </div>
            </details>
            {setupStatus === "ready" && <p className="agentlens-sr-only" role="status">{t("creator.visibleCount", { visible: visibleCreators.length, total: creators.length })}</p>}
            <div className="agentlens-creator-grid" ref={creatorResultsRef} tabIndex={-1}>
            {setupStatus === "loading" ? <p role="status">Loading creators…</p> : setupStatus === "error" ? <div><p>Unable to load creators.</p><button type="button" onClick={() => setSetupAttempt(value => value + 1)}>Retry loading creators</button></div> : creators.length === 0 ? <div className="agentlens-auto-empty" role="status"><EmptyStateIllustration /><p>No creators followed in this Vault.</p></div> : visibleCreators.length === 0 ? <p>{t("creator.noMatches")}</p> : visibleCreators.map((creator) => <div className="agentlens-creator-row" key={creator.creatorId}>
              <article>
                <div className={`agentlens-creator-identity${creator.avatarUrl ? " has-avatar" : ""}`}>{creator.avatarUrl && <RemoteImage className="agentlens-creator-avatar" url={creator.avatarUrl} alt="Creator" />}<strong title={creator.displayName}>{creator.displayName}</strong><span><PlatformIcon variant="creator" id={creator.platform} /><span className="agentlens-creator-handle" title={creator.handle ? `@${creator.handle.replace(/^@/, "")}` : creator.platform}>{creator.handle ? `@${creator.handle.replace(/^@/, "")}` : creator.platform}</span></span></div>

                <CreatorBadge pendingSync={pendingConfiguration.has(creator.followId ?? "")} creator={creator} activity={service?.autoFetchActivity?.(creator.creatorId, creator.saveFolderPath)} />
                <CreatorStatus creator={creator} />
                <div className="agentlens-creator-actions">
                <button type="button" className="agentlens-creator-folder-link" onClick={() => onOpenFolder?.(creator.saveFolderPath)} disabled={!onOpenFolder} aria-label={`Open folder ${creator.saveFolderPath}`} title={creator.saveFolderPath}><span className="agentlens-creator-folder">{creator.saveFolderPath.split("/").join(" / ")}</span><img src={creatorFolderLink} width="12" height="12" alt="" /></button>
                <button className="agentlens-state-action" type="button" onClick={() => void checkCreatorNow(creator)} disabled={checking.has(creator.creatorId)} aria-label="Check now" title="Check now · may use credits"><ActionStateIcon kind="run" size={20} /></button>
                <button className="agentlens-state-action" type="button" onClick={() => void toggleCreator(creator)} disabled={toggling.has(creator.creatorId) || pendingConfiguration.has(creator.followId ?? "")} aria-label={creator.autoFetchEnabled ? "Pause future checks" : "Resume on original cadence"} title={creator.autoFetchEnabled ? "Pause future checks" : "Resume on original cadence"}><ActionStateIcon kind={creator.autoFetchEnabled ? "pause" : "play"} size={20} /></button>
                <button className="agentlens-state-action" type="button" onClick={() => beginEdit(creator)} disabled={busy || pendingConfiguration.has(creator.followId ?? "")} aria-label="Edit" title="Edit"><ActionStateIcon kind="settings" size={20} /></button>



                </div>
              </article>

            </div>)}
            </div>
            {syncResult && <p role="status">{syncResult}</p>}
          </section>
          {error && !adding && <p className="agentlens-inline-error" role="alert">{error}</p>}
        </div>
)}
    </div>
);
}

function maximumFrequencyEvery(unit: FrequencyUnit, minuteMax = 59): number {
  return unit === "minute" ? minuteMax : unit === "week" ? 12 : 30;
}

function clampEvery(value: number, unit: FrequencyUnit, minuteMax = 59): number {
  const integer = Math.max(1, Math.floor(Number.isFinite(value) ? value : 1));
  return Math.min(maximumFrequencyEvery(unit, minuteMax), integer);
}
