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
import type { AutoFetchCapabilities, CreatorParseResult, CreatorRecord, CreatorSchedulePreview, FrequencyUnit } from "../../api/AgentLensApiClient";
import type { AccountCapabilities } from "../../api/contracts";
import type { TemplateId, WorkbenchDefaults } from "./types";
import { PlatformIcon, RemoteThumbnail, SupportedPlatforms, message, operationAvailable } from "./shared";
import { redactPersistentUrl } from "../../core/urls";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { parsedCheck, frequencyCheck, scheduleChevron } from "./creatorAssets";
import { CreatorStatus, CreatorBadge } from "./CreatorStatus";
import { useI18n } from "../../i18n/I18nProvider";
import { WorkflowOnboarding } from "./WorkflowOnboarding";

export function AutoFetchPane({
  onOpenFolder,
  onRequestSignUp,
  service,
  signedIn,
  capabilities,
  defaults,
  onDraftChange,
  onAccountChanged,
  removedFollowId
}: {
  removedFollowId?: string | undefined;
  onOpenFolder?: ((path: string) => void) | undefined;
  service?: AutoFetchWorkbenchPort | undefined;
  signedIn: boolean;
  onRequestSignUp?: (()=>void) | undefined;
  capabilities: AccountCapabilities | null;
  defaults: WorkbenchDefaults;
  onDraftChange: (dirty: boolean) => void;
  onAccountChanged?: (() => void) | undefined;
}) {
  const { t } = useI18n();
  const vault = useContext(VaultFoldersContext);
  const creatorResultsRef = useRef<HTMLDivElement>(null);
  const profileInputRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [setupStep, setSetupStep] = useState(0);
  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [timezone, setTimezone] = useState(detectedTimezone);
  const [timezoneConfirmed, setTimezoneConfirmed] = useState(false);
  const [profileUrl, setProfileUrl] = useState("");
  const [folderPath, setFolderPath] = useState(defaults.folderPath);
  const [autoFetchCapabilities, setAutoFetchCapabilities] = useState<AutoFetchCapabilities | null>(null);
  const [every, setEvery] = useState(defaults.autoEvery);
  const [unit, setUnit] = useState<FrequencyUnit>(defaults.autoUnit);
  const [preferredTime, setPreferredTime] = useState(defaults.autoPreferredTime);
  const [noteTemplateId, setNoteTemplateId] = useState<TemplateId>(defaults.templateId);
  const [mediaPolicy, setMediaPolicy] = useState<MediaPolicy>(defaults.mediaPolicy);
  const [parsed, setParsed] = useState<CreatorParseResult | null>(null);
  const [setupStatus, setSetupStatus] = useState<"loading" | "ready" | "error">("loading");
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [creators, setCreators] = useState<readonly CreatorRecord[]>([]);
  const [creatorSearch, setCreatorSearch] = useState("");
  const [creatorPlatform, setCreatorPlatform] = useState("all");
  const [creatorState, setCreatorState] = useState("all");
  const visibleCreators = creators.filter((creator) => {
    const matchesText = `${creator.displayName} ${creator.platform} ${creator.handle ?? ""} ${creator.profileUrl} ${creator.saveFolderPath}`.toLocaleLowerCase().includes(creatorSearch.trim().toLocaleLowerCase());
    const needsAttention = ["retry_pending", "quota_blocked", "auth_blocked"].includes(creator.schedulerState) || Boolean(creator.lastError);
    return matchesText && (creatorPlatform === "all" || creator.platform === creatorPlatform)
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
  const [settingsPreview, setSettingsPreview] = useState<CreatorSchedulePreview | null>(null);
  const settingsDraftRevision = useRef(0);
  const profileDraftRevision = useRef(0);

  useEffect(() => { if (removedFollowId) setCreators(current => current.filter(creator => creator.followId !== removedFollowId)); }, [removedFollowId]);

  useEffect(() => onDraftChange(Boolean(parsed || editing)), [parsed, editing, onDraftChange]);

  useEffect(() => {
    setAutoFetchCapabilities(null);
    setCreators([]);
    setSetupStatus("loading");
    setError(null);
    if (!service || !signedIn) return;
    let active = true;
    setBusy(true);
    void service.autoFetchSetup().then(
      (setup) => {
        if (!active) return;
        setCreators(setup.creators);
        setSetupStatus("ready");
        setAutoFetchCapabilities(setup.autoFetchCapabilities ?? null);
        if (setup.settings.homeTimezone) setTimezone(setup.settings.homeTimezone);
        setTimezoneConfirmed(setup.settings.confirmed);
      },
      (caught) => { if (active) { setSetupStatus("error"); setError(message(caught, "read_only")); } }
).finally(() => active && setBusy(false));
    return () => { active = false; };
  }, [service, signedIn, setupAttempt]);

  async function refreshCreators() {
    if (!service) return;
    setBusy(true);
    setError(null);
    try {
      const setup = await service.autoFetchSetup();
      setCreators(setup.creators);
        setAutoFetchCapabilities(setup.autoFetchCapabilities ?? null);
    } catch (caught) {
      setError(message(caught, "read_only"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmTimezone() {
    if (!service) return;
    setBusy(true);
    setError(null);
    try {
      await service.confirmTimezone(timezone);
      setTimezoneConfirmed(true);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function parseProfile(event: SyntheticEvent) {
    event.preventDefault();
    if (!service) return;
    const revision = profileDraftRevision.current;
    const requestedUrl = profileUrl.trim();
    setParsed(null);
    setBusy(true);
    setError(null);
    try {
      const result = await service.parseCreator(requestedUrl);
      if (revision === profileDraftRevision.current) setParsed(result);
    } catch (caught) {
      if (revision === profileDraftRevision.current) setError(message(caught));
    } finally {
      if (revision === profileDraftRevision.current) setBusy(false);
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
    if (!service || !parsed || !validTimezone(timezone)) return;
    setBusy(true);
    setError(null);
    try {
      validateFrequency();
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
      setCreators((current) => [creator, ...current.filter((item) => item.creatorId !== creator.creatorId)]);
      setParsed(null);
      setProfileUrl("");
      setAdding(false);
      setSetupStep(0);
    } catch (caught) {
      setError(message(caught));
    } finally {
      if (signedIn) onAccountChanged?.();
      setBusy(false);
    }
  }

  async function toggleCreator(creator: CreatorRecord) {
    if (!service) return;
    setBusy(true);
    try {
      const updated = await service.setCreatorEnabled(creator.creatorId, !creator.autoFetchEnabled);
      setCreators((current) => current.map((item) => item.creatorId === updated.creatorId ? updated : item));
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    if (!service) return;
    setBusy(true);
    setError(null);
    try {
      const result = await service.runScheduled("manual_sync");
      setSyncResult(`${result.leases} creator check(s), ${result.saved} saved, ${result.failed} failed.${result.deferred ? ` ${result.deferred} waiting for another check.` : ""}${result.terminated ? ` ${result.terminated} check(s) ended unsuccessfully.` : ""}`);
      const setup = await service.autoFetchSetup();
      setCreators(setup.creators);
        setAutoFetchCapabilities(setup.autoFetchCapabilities ?? null);
    } catch (caught) {
      setError(message(caught));
    } finally {
      if (signedIn) onAccountChanged?.();
      setBusy(false);
    }
  }

  async function checkCreatorNow(creator: CreatorRecord) {
    if (!service) return;
    setBusy(true);
    setError(null);
    try {
      const retryPending = creator.schedulerState === "retry_pending" && Boolean(creator.activeJobId);
      const result = retryPending
        ? await service.retryCreator(creator)
        : await service.runCreatorNow(creator);
      setSyncResult(`${creator.displayName}: ${result.saved} saved, ${result.failed} failed.${result.deferred ? ` ${result.deferred} waiting for another check.` : ""}${result.terminated ? ` ${result.terminated} check(s) ended unsuccessfully.` : ""}`);
      const setup = await service.autoFetchSetup();
      setCreators(setup.creators);
        setAutoFetchCapabilities(setup.autoFetchCapabilities ?? null);
    } catch (caught) {
      setError(message(caught));
    } finally {
      if (signedIn) onAccountChanged?.();
      setBusy(false);
    }
  }

  async function deleteCreator(creator: CreatorRecord) {
    if (!service) return;
    if (pendingDelete !== creator.creatorId) {
      setPendingDelete(creator.creatorId);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await service.deleteCreator(creator.creatorId);
      setCreators((current) => current.filter((item) => item.creatorId !== creator.creatorId));
      setPendingDelete(null);
      if (editing?.creatorId === creator.creatorId) closeSetup();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  function closeSetup() {
    settingsDraftRevision.current += 1;
    profileDraftRevision.current += 1;
    setAdding(false);
    setEditing(null);
    setSettingsPreview(null);
    setError(null);
    if (restoreAddDraft.current) { restoreAddDraft.current(); restoreAddDraft.current = null; }
    else setParsed(null);
  }

  function beginEdit(creator: CreatorRecord) {
    restoreAddDraft.current = () => {
      setFolderPath(folderPath); setTimezone(timezone); setEvery(every); setUnit(unit);
      setPreferredTime(preferredTime); setNoteTemplateId(noteTemplateId); setMediaPolicy(mediaPolicy);
      setProfileUrl(profileUrl); setParsed(parsed); setTimezoneConfirmed(timezoneConfirmed);
    };
    setAdding(true); setSetupStep(2); setTimezoneConfirmed(true); setProfileUrl(creator.profileUrl); setError(null);
    settingsDraftRevision.current += 1;
    setEditing(creator);
    setFolderPath(creator.saveFolderPath);
    setTimezone(creator.timezone);
    setEvery(creator.frequency.every);
    setUnit(creator.frequency.unit);
    setPreferredTime(creator.preferredTimes[0] ?? "");
    setNoteTemplateId(creator.noteTemplateId);
    setMediaPolicy(creator.mediaPolicy);
    setSettingsPreview(null);
  }

  function invalidateSettingsPreview() {
    settingsDraftRevision.current += 1;
    setSettingsPreview(null);
  }

  async function reviewSettings() {
    if (!service || !editing) return;
    const revision = settingsDraftRevision.current;
    setBusy(true);
    setError(null);
    try {
      validateFrequency();
      const preview = await service.previewCreatorSettings(editing.creatorId, {
        saveFolderPath: folderPath,
        timezone: timezone,
        every: every,
        unit: unit,
        preferredTimes: every === 1 && unit === "day" && preferredTime ? [preferredTime] : [],
        noteTemplateId: noteTemplateId,
        mediaPolicy: mediaPolicy
      });
      if (revision === settingsDraftRevision.current) setSettingsPreview(preview);
    } catch (caught) {
      if (revision === settingsDraftRevision.current) setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  async function applySettings() {
    if (!service || !editing || !settingsPreview) return;
    setBusy(true);
    setError(null);
    try {
      validateFrequency();
      const updated = await service.updateCreatorSettings(editing.creatorId, {
        saveFolderPath: folderPath,
        timezone: timezone,
        every: every,
        unit: unit,
        preferredTimes: every === 1 && unit === "day" && preferredTime ? [preferredTime] : [],
        noteTemplateId: noteTemplateId,
        mediaPolicy: mediaPolicy
      }, settingsPreview.previewToken);
      setCreators((current) => current.map((item) => item.creatorId === updated.creatorId ? updated : item));
      closeSetup();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="agentlens-pane agentlens-auto-pane">
      <div className="agentlens-pane__intro">
        <p className="agentlens-eyebrow">CREATOR UPDATES, SAVED TO Obsidian</p>
        <h2>Auto-Fetch</h2>
        <p>Follow creators and automatically check for and import new posts on schedule.</p>
      </div>
      <SupportedPlatforms capabilities={capabilities} mode="autoFetch" />
      {!signedIn ? (
        <WorkflowOnboarding variant="auto" onRequestSignUp={onRequestSignUp} />
) : (
        <div className="agentlens-auto-layout">
          <button type="button" className="mod-cta agentlens-add-creator" onClick={() => { setAdding(true); setSetupStep(0); }} disabled={busy || setupStatus !== "ready"}>+ Add creator</button>
          {adding && <WorkbenchDialog textClose className={`agentlens-creator-dialog step-${setupStep}`} title="Auto-Fetch New Posts" onClose={() => { if (!busy) closeSetup(); }}>
          <p>Add a creator once, and new posts will be automatically synced to Obsidian.</p>
          <ol className="agentlens-setup-steps">{["Creator Profile", "Save Location", "Check Schedule"].map((step, index) => <li key={step} className={index < setupStep ? "is-completed" : undefined} aria-current={setupStep === index ? "step" : undefined}><span>{index < setupStep ? "✓" : index + 1}</span><div>{step}<small>{["Paste and parse link", "Select folder and path", "Set update schedule"][index]}</small></div></li>)}</ol>
          <section className="agentlens-setup-content" aria-label={editing ? `Edit ${editing.displayName}` : undefined} onChangeCapture={() => { if (editing) invalidateSettingsPreview(); }}>
          {!timezoneConfirmed && <section className="agentlens-timezone-confirm">
            <div><strong>Confirm home timezone</strong><span>Schedules use a canonical IANA timezone and remain stable across daylight-saving changes.</span></div>
            <input aria-label="Home timezone" value={timezone} onChange={(event) => setTimezone(event.currentTarget.value)} />
            <button type="button" className="mod-cta" onClick={() => void confirmTimezone()} disabled={busy || !timezone.trim()}>Confirm timezone</button>
          </section>}
          {timezoneConfirmed && setupStep === 0 && <form className="agentlens-follow-form agentlens-setup-url" onSubmit={(event) => void parseProfile(event)}>
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
            {editing && setupStep === 0 && redactPersistentUrl(editing.profileUrl) && <a href={redactPersistentUrl(editing.profileUrl)} target="_blank" rel="noreferrer">{t("creator.openProfile")}</a>}
            <div hidden={setupStep !== 1} className="agentlens-setup-destination">
              <VaultFolderPicker value={folderPath} onChange={path => { setFolderPath(path); if (editing) invalidateSettingsPreview(); }} />
              <div className="agentlens-destination-options" style={mediaControlStyle}><label>Template<select aria-label="Note template" value={noteTemplateId} onChange={event => setNoteTemplateId(event.currentTarget.value as TemplateId)}><option value="default">Default template</option></select></label>
                <fieldset><legend>Media attachments</legend><div>{(['download_all','link_only',...(mediaPolicy === 'download_images_only' ? ['download_images_only'] : [])] as MediaPolicy[]).map(policy => <label className={mediaPolicy===policy ? 'is-selected' : ''} key={policy}><input type="radio" name="creator-media" value={policy} checked={mediaPolicy===policy} onChange={() => setMediaPolicy(policy)} />{policy==='download_all' ? 'Download available' : policy==='link_only' ? 'Link only' : 'Images only'}</label>)}</div></fieldset>
              </div>
              <label className="agentlens-destination-path">SAVE TO<input aria-label="Destination folder" value={folderPath} onChange={event => setFolderPath(event.currentTarget.value)} /></label>
            </div>
            <div hidden={setupStep !== 2} className="agentlens-schedule-settings" style={{"--agentlens-schedule-chevron": `url("${scheduleChevron}")`} as CSSProperties}>
              <fieldset className="agentlens-frequency-presets"><legend>FREQUENCY</legend><div>{([{label:'Every 1 hour',every:1,unit:'hour'},{label:'Every 2 hours',every:2,unit:'hour'},{label:'Every 4 hours',every:4,unit:'hour'},{label:'Daily',every:1,unit:'day'},{label:'Weekly',every:1,unit:'week'}] as const).map(preset => <button key={preset.label} type="button" aria-pressed={unit===preset.unit && (preset.unit==='week' || every===preset.every)} onClick={()=>{setEvery(preset.every);setUnit(preset.unit);if (editing) invalidateSettingsPreview();}}>{unit===preset.unit && (preset.unit==='week' || every===preset.every) && <img src={frequencyCheck} width="9" height="7" alt="" />}{preset.label}</button>)}</div></fieldset>
              <div className="agentlens-schedule-every"><span>EVERY</span><div><select aria-label="Frequency" value={every} onChange={event=>{setEvery(Number(event.currentTarget.value));if(editing) invalidateSettingsPreview();}}>{Array.from({length: unit === "minute" ? autoFetchCapabilities?.minuteFrequencyMaxEvery ?? 59 : unit === "week" ? 12 : 168}, (_, index) => <option key={index+1} value={index+1}>{index+1}</option>)}</select><select aria-label="Unit" value={unit} onChange={event=>{const next=event.currentTarget.value as FrequencyUnit;setUnit(next);setEvery(current=>clampEvery(current,next,autoFetchCapabilities?.minuteFrequencyMaxEvery));if(editing) invalidateSettingsPreview();}}>{(autoFetchCapabilities?.minuteFrequencyAvailable || unit === "minute") && <option value="minute" disabled={!autoFetchCapabilities?.minuteFrequencyAvailable}>Minutes</option>}<option value="hour">Hours</option><option value="day">Days</option><option value="week">Weeks</option></select></div></div>
              {every===1 && unit==='day' && <label className="agentlens-schedule-time">Daily time<input type="time" value={preferredTime} onChange={event=>setPreferredTime(event.currentTarget.value)} /></label>}
              <TimezoneField value={timezone} onChange={zone => { setTimezone(zone); if (editing) invalidateSettingsPreview(); }} chevron={scheduleChevron} />
              <div className="agentlens-schedule-summary"><dl><div><dt>VAULT</dt><dd>{vault.name}</dd></div><div><dt>SAVE TO</dt><dd>{folderPath}</dd></div><div><dt>TEMPLATE</dt><dd>{folderPath}</dd></div><div><dt>MEDIA ATTACHMENTS</dt><dd>{mediaPolicy==='download_all'?'Download available':mediaPolicy==='link_only'?'Link only':'Images only'}</dd></div></dl>
                <div className="agentlens-schedule-creator"><RemoteThumbnail url={setupCreator.avatarUrl ?? undefined} kind="Creator" /><strong>{setupCreator.displayName}</strong><span><PlatformIcon variant="creator" id={setupCreator.platform} />{setupCreator.handle ? `@${setupCreator.handle.replace(/^@/,'')}` : setupCreator.profileUrl}</span></div>
                <p className="agentlens-parse-error">Note: After following, only new posts from this point forward will be imported. Historical posts will not be fetched. Each update check may consume one fetch quota.</p>
              </div>
            </div>
          </section>}
          {error && <p className={setupStep === 0 ? "agentlens-parse-error" : "agentlens-inline-error"} role="alert">{error}</p>}
          {settingsPreview && <p className="agentlens-settings-preview" role="status">Next check: {settingsPreview.oldNextCheckAt ?? "none"} → {settingsPreview.newNextCheckAt ?? "none"}</p>}
          </section>
          <footer className="agentlens-dialog-actions">
            {(editing || setupStep === 1) && <button type="button" className="agentlens-remove-draft" disabled={busy} onClick={() => { if (editing) { void deleteCreator(editing); return; } profileDraftRevision.current += 1; setParsed(null); setProfileUrl(""); setSetupStep(0); }}>Remove</button>}
            <button type="button" disabled={busy} onClick={() => { if (setupStep > 0) { setSetupStep(setupStep - 1); setSettingsPreview(null); } else closeSetup(); }}>{setupStep > 0 ? "Back" : "Cancel"}</button>
            {setupStep < 2 ? <button type="button" className="mod-cta" disabled={busy || (setupStep === 1 && !folderPath.trim())} onClick={() => { if (!setupCreator) { setError(current => current ?? "Parse a creator profile before continuing."); profileInputRef.current?.focus(); return; } setSetupStep(setupStep + 1); }}>Continue</button> : <button type="button" className="mod-cta" onClick={() => void (editing ? settingsPreview ? applySettings() : reviewSettings() : follow())} aria-label={editing ? settingsPreview ? "Confirm changes" : "Review changes" : "Follow creator"} disabled={busy || !folderPath.trim() || !validTimezone(timezone)}>{settingsPreview ? "Confirm changes" : "Continue"}</button>}
          </footer>
          </WorkbenchDialog>}
          {pendingDelete && <WorkbenchDialog compact title="Remove this creator from Auto-Fetch?" className="agentlens-remove-dialog" onClose={() => {if (!busy) setPendingDelete(null);}}>
            <p>This removes the creator from the follow list and stops automatic checks and downloads. Existing Obsidian files and AgentLens history will be retained.</p>
            {error && <p role="alert" className="agentlens-inline-error">{error}</p>}
            <footer className="agentlens-dialog-actions"><button type="button" onClick={() => setPendingDelete(null)} disabled={busy}>Cancel</button><button type="button" className="agentlens-remove-draft" onClick={() => {const creator = creators.find(item => item.creatorId === pendingDelete); if (creator) void deleteCreator(creator);}} disabled={busy}>Remove</button></footer>
          </WorkbenchDialog>}
          <section className="agentlens-creator-list" aria-label="Followed creators">
            <div className="agentlens-url-bar agentlens-creator-search">              <input type="search" aria-label={t("creator.search")} placeholder="Search creator or platform" value={creatorSearch} onChange={(event) => setCreatorSearch(event.currentTarget.value)} />{creatorSearch && <button type="button" className="agentlens-clear-input" aria-label="Clear creator search" onClick={() => setCreatorSearch("")}>×</button>}<button type="button" className="mod-cta" onClick={() => creatorResultsRef.current?.focus()}>Search</button></div>
            <details className="agentlens-creator-tools"><summary>Filters &amp; sync{setupStatus === "ready" && <> · {creators.length} creators</>}</summary><p>Checks run only while Obsidian is active and online. Sync checks due creators without changing their schedule.</p><button type="button" onClick={() => void syncNow()} disabled={busy}>Sync due creators</button>
            <div className="agentlens-bulk-filters" aria-label={t("creator.search")}>

              <label>{t("creator.filterPlatform")}<select value={creatorPlatform} onChange={(event) => setCreatorPlatform(event.currentTarget.value)}><option value="all">{t("creator.allPlatforms")}</option>{[...new Set(creators.map((creator) => creator.platform))].sort().map((platform) => <option key={platform} value={platform}>{platform}</option>)}</select></label>
              <label>{t("creator.filterState")}<select value={creatorState} onChange={(event) => setCreatorState(event.currentTarget.value)}><option value="all">{t("creator.allStates")}</option><option value="enabled">{t("creator.enabled")}</option><option value="paused">{t("creator.paused")}</option><option value="attention">{t("creator.needsAttention")}</option></select></label>
              <button type="button" onClick={() => void refreshCreators()} disabled={busy}>{t("creator.refresh")}</button>
            </div>
            </details>
            {setupStatus === "ready" && <p className="agentlens-sr-only" role="status">{t("creator.visibleCount", { visible: visibleCreators.length, total: creators.length })}</p>}
            <div className="agentlens-creator-grid" ref={creatorResultsRef} tabIndex={-1}>
            {setupStatus === "loading" ? <p role="status">Loading creators…</p> : setupStatus === "error" ? <div><p>Unable to load creators.</p><button type="button" onClick={() => setSetupAttempt(value => value + 1)}>Retry loading creators</button></div> : creators.length === 0 ? <p>No creators followed in this Vault.</p> : visibleCreators.length === 0 ? <p>{t("creator.noMatches")}</p> : visibleCreators.map((creator) => <div className="agentlens-creator-row" key={creator.creatorId}>
              <article>
                <div className="agentlens-creator-identity">{creator.avatarUrl && <RemoteImage className="agentlens-creator-avatar" url={creator.avatarUrl} alt="Creator" />}<strong title={creator.displayName}>{creator.displayName}</strong><span><PlatformIcon variant="creator" id={creator.platform} /><span className="agentlens-creator-handle" title={creator.handle ? `@${creator.handle.replace(/^@/, "")}` : creator.platform}>{creator.handle ? `@${creator.handle.replace(/^@/, "")}` : creator.platform}</span></span></div>

                <CreatorBadge creator={creator} />
                <CreatorStatus creator={creator} />
                <div className="agentlens-creator-actions">
                <button type="button" className="agentlens-creator-folder-link" onClick={() => onOpenFolder?.(creator.saveFolderPath)} disabled={!onOpenFolder} aria-label={`Open folder ${creator.saveFolderPath}`} title={creator.saveFolderPath}><span className="agentlens-creator-folder">{creator.saveFolderPath.split("/").join(" / ")}</span><img src={creatorFolderLink} width="12" height="12" alt="" /></button>
                {(creator.autoFetchEnabled && (!creator.activeJobId || creator.schedulerState === "retry_pending")) && <button type="button" onClick={() => void checkCreatorNow(creator)} disabled={busy || (Boolean(creator.activeJobId) && creator.schedulerState !== "retry_pending") || !creator.autoFetchEnabled || creator.schedulerState === "quota_blocked" || creator.schedulerState === "auth_blocked"} aria-label={creator.schedulerState === "retry_pending" && creator.activeJobId ? t("creator.retryNow") : creator.activeJobId ? `Running ${creator.activeJobTrigger ?? "job"}` : "Check now"} title={creator.schedulerState === "retry_pending" && creator.activeJobId ? t("creator.retryNow") : creator.activeJobId ? `Running ${creator.activeJobTrigger ?? "job"}` : "Check now"}><ActionStateIcon kind="run" size={20} /></button>}
                <button type="button" onClick={() => void toggleCreator(creator)} disabled={busy || Boolean(creator.activeJobId) || creator.schedulerState === "quota_blocked" || creator.schedulerState === "auth_blocked"} aria-label={creator.autoFetchEnabled ? "Pause future checks" : "Resume on original cadence"} title={creator.autoFetchEnabled ? "Pause future checks" : "Resume on original cadence"}><ActionStateIcon kind={creator.autoFetchEnabled ? "pause" : "play"} size={20} /></button>
                <button type="button" onClick={() => beginEdit(creator)} disabled={busy} aria-label="Edit" title="Edit"><ActionStateIcon kind="settings" size={20} /></button>


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

function clampEvery(value: number, unit: FrequencyUnit, minuteMax = 59): number {
  const integer = Math.max(1, Math.floor(Number.isFinite(value) ? value : 1));
  return Math.min(unit === "minute" ? minuteMax : unit === "week" ? 12 : 168, integer);
}
