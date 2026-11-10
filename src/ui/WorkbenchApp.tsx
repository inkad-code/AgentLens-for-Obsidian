import { DemoAuthDialog } from "./workbench/DemoAuthDialog";
import { DiagnosticExportDialog } from "./workbench/DiagnosticExportDialog";
import { AccountFollowsDialog } from "./workbench/AccountFollowsDialog";
import { SINGLE_FETCH_REVIEW } from "../core/releaseProfile";
import { useHostDocument, useHostWindow } from "./workbench/HostDocument";
import { WorkbenchDialog } from "./workbench/WorkbenchDialog";
import { EmailAuthPage } from "./workbench/EmailAuthPage";
import { PlanSelectionPage } from "./workbench/PlanSelectionPage";
import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import type { AgentLensWorkbenchPort } from "../workbench/ports";
import { ActivityPane } from "./ActivityPane";
import { SingleFetchPane } from "./workbench/SingleFetchPane";
import { BulkFetchPane } from "./workbench/BulkFetchPane";
import { AutoFetchPane } from "./workbench/AutoFetchPane";
import { SupportedPlatforms, billingAction } from "./workbench/shared";
import { useWorkbenchSession } from "./workbench/useWorkbenchSession";
import { useWorkflowTabs, WORKBENCH_TABS } from "./workbench/useWorkflowTabs";
import { VaultFoldersContext } from "./workbench/FolderField";
import { MarkdownPreviewContext, type MarkdownPreviewRenderer } from "./workbench/MarkdownPreview";
import { importAssets } from "./workbench/importAssets";
import { accountAssets } from "./workbench/accountAssets";
import { designAssets } from "./workbench/designAssets";
import type { WorkbenchDefaults, WorkbenchTab } from "./workbench/types";
import { I18nProvider, useI18n } from "../i18n/I18nProvider";
import type { Locale, TranslationKey } from "../i18n/catalog";
import { UpdateNotice } from "./workbench/UpdateNotice";
import type { PluginUiPreferences } from "../runtime/PluginStateStore";

export type { WorkbenchDefaults, WorkbenchTab } from "./workbench/types";

export interface WorkbenchAppProps {
  locale?: Locale | undefined;
  initialTab?: WorkbenchTab;
  initialUrl?: string | undefined;
  service?: AgentLensWorkbenchPort | undefined;
  onOpenFolder?: ((path: string) => void) | undefined;
  onOpenNote?: ((path: string) => void) | undefined;
  defaults?: WorkbenchDefaults | undefined;
  vaultFolders?: readonly string[] | undefined;
  vaultName?: string | undefined;
  vaultFolderCounts?: Readonly<Record<string, number>> | undefined;
  onRefreshFolders?: (() => void) | undefined;
  recentFolder?: string | undefined;
  renderMarkdown?: MarkdownPreviewRenderer | undefined;
  onClose?: (() => void) | undefined;
  onDirtyStateChange?: ((dirty: boolean) => void) | undefined;
}

const FALLBACK_DEFAULTS: WorkbenchDefaults = {
  folderPath: "AgentLens/Inbox",
  templateId: "default",
  mediaPolicy: "download_all",
  autoEvery: 4,
  autoUnit: "hour",
  autoPreferredTime: "09:00"
};

export function WorkbenchApp(props: WorkbenchAppProps) {
  const [recentFolder, setRecentFolder] = useState(props.recentFolder);
  const folderSelected = useRef(false);
  useEffect(() => {
    let active = true;
    void props.service?.uiPreferences?.().then(preferences => {
      if (active && !folderSelected.current && preferences.recentFolder) setRecentFolder(preferences.recentFolder);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [props.service]);
  const [folderError, setFolderError] = useState(false);
  function selectFolder(path: string) {
    folderSelected.current = true;
    setRecentFolder(path);
    setFolderError(false);
    void props.service?.setUiPreferences?.({ recentFolder: path }).catch(() => setFolderError(true));
  }
  return <I18nProvider {...(props.locale ? { locale: props.locale } : {})}><MarkdownPreviewContext.Provider value={props.renderMarkdown}><VaultFoldersContext.Provider value={{paths: props.vaultFolders ?? [], name: props.vaultName ?? "Current Vault", counts: props.vaultFolderCounts ?? {}, recent: recentFolder, onSelect: selectFolder, refresh: props.onRefreshFolders}}>{folderError && <p role="alert">Could not remember the last folder. Please select it again next time.</p>}<WorkbenchContent {...props} /></VaultFoldersContext.Provider></MarkdownPreviewContext.Provider></I18nProvider>;
}

function WorkbenchContent({ initialTab = "single", initialUrl, service, onOpenNote, onOpenFolder, defaults = FALLBACK_DEFAULTS, onClose, onDirtyStateChange }: WorkbenchAppProps) {
  const document = useHostDocument();
  const window = useHostWindow();
  const { t } = useI18n();
  const {
    activeTab, resetVersions, setDraft, requestTab, handleKeyDown
  } = useWorkflowTabs(SINGLE_FETCH_REVIEW && initialTab === "auto" ? "single" : initialTab, onDirtyStateChange);
  const {
    authState, authRestoring, authBusy, authRecovering, sessionRecovery, authError, capabilities, capabilitiesError, publicCatalog, publicCatalogError, account, accountUpdatedAt,
    accountStale, accountBusy, beginSignIn, retryRestore,
    cancelSignIn, signOut, refreshAccount, emailSignIn, openAuthorizationPage
  } = useWorkbenchSession(service);
  const [view, setView] = useState<"workflows" | "activity" | "login" | "register" | "plans">("workflows");
  // Window reopen and legacy sessions always use the in-plugin authentication page.
  useEffect(() => {
    if (authState.status === "authorizing" && !authState.provider) {
      void cancelSignIn().then(() => setView("login"));
    } else if (authState.status === "authorizing" || (authState.status === "error" && authState.provider === "google")) {
      setView(current => current === "register" ? current : "login");
    }
  }, [authState]);
  const [uiPreferences, setUiPreferences] = useState<PluginUiPreferences>({});
  const [preferencesLoaded, setPreferencesLoaded] = useState(!service?.uiPreferences);
  const panelId = useId();
  const [accountOpen, setAccountOpen] = useState(false);
  const [diagnosticOwner, setDiagnosticOwner] = useState<string>();
  const diagnosticScope = authState.status === "signed_in" && account ? JSON.stringify([account.user.id, account.installationId]) : undefined;
  useEffect(() => { setDiagnosticOwner(undefined); }, [diagnosticScope, service]);
  const [showAccountFollows, setShowAccountFollows] = useState(false);
  const [removedFollowId, setRemovedFollowId] = useState<string>();
  useEffect(() => { setShowAccountFollows(false); setRemovedFollowId(undefined); }, [service, authState.status]);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const accountPanel = useRef<HTMLElement>(null);
  const focusAccountOnOpen = useRef(false);
  function focusFirstAccountAction() { accountPanel.current?.querySelector<HTMLAnchorElement>('nav a')?.focus(); }
  useEffect(() => {
    if (authState.status !== "signed_in") {setAccountOpen(false);setView(current=>current === "activity" || current === "plans" ? "workflows" : current);}
  }, [authState.status]);
  useEffect(() => {
    if (!accountOpen) return;
    if (focusAccountOnOpen.current && accountPanel.current) { focusFirstAccountAction(); focusAccountOnOpen.current = false; }
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof window.Node && !accountPanel.current?.contains(event.target) && !accountTrigger.current?.contains(event.target)) setAccountOpen(false);
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); setAccountOpen(false); accountTrigger.current?.focus();
    };
    document.addEventListener('pointerdown', dismissOutside);
    window.addEventListener('keydown', dismissWithEscape, true);
    window.addEventListener('agentlens-escape', dismissWithEscape as EventListener, true);
    return () => { document.removeEventListener('pointerdown', dismissOutside); window.removeEventListener('keydown', dismissWithEscape, true); window.removeEventListener('agentlens-escape', dismissWithEscape as EventListener, true); };
  }, [accountOpen, account]);
  const [signUpPrompt,setSignUpPrompt]=useState(false);
  const [demoAuthOpen,setDemoAuthOpen]=useState(false);
  useEffect(()=>{if(authState.status === "signed_in")setDemoAuthOpen(false);},[authState.status]);
  const [bulkNavigationVersion, setBulkNavigationVersion] = useState(0);
  const [bulkSaveView,setBulkSaveView]=useState(false);
  const [singleSaveView,setSingleSaveView]=useState(false);
  const [singleHasPreview,setSingleHasPreview]=useState(false);
  const fittedSingle = view === "workflows" && activeTab === "single" && singleHasPreview && !singleSaveView;
  const workflowBody = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (fittedSingle && workflowBody.current) workflowBody.current.scrollTop = 0; }, [fittedSingle]);

  useEffect(()=>{if(authState.status === "signed_in")setView(current=>current === "login" || current === "register" ? "workflows" : current);},[authState.status]);
  const googleAuthActive = (authState.status === "authorizing" || authState.status === "error") && authState.provider === "google";
  useEffect(() => {
    if (googleAuthActive) setView(current => current === "register" ? current : "login");
  }, [googleAuthActive]);

  useEffect(() => {
    if (!service?.uiPreferences) {
      setPreferencesLoaded(true);
      return;
    }
    let active = true;
    void service.uiPreferences().then((preferences) => {
      if (active) setUiPreferences(preferences);
    }).finally(() => {
      if (active) setPreferencesLoaded(true);
    });
    return () => { active = false; };
  }, [service]);

  function dismissUpdate(version: string) {
    const next = { ...uiPreferences, dismissedUpdateVersion: version };
    setUiPreferences(next);
    void service?.setUiPreferences?.({ dismissedUpdateVersion: version });
  }

  return (
    <section className={`agentlens-workbench${view === "login" || view === "register" ? " has-auth-page" : ""}${authBusy || (authState.status === "authorizing" && authState.provider === "google") ? " has-auth-operation" : ""}${fittedSingle ? " has-fitted-single" : ""}`} aria-labelledby={`${panelId}-workbench-name`}>
      <span className="agentlens-sr-only" id={`${panelId}-workbench-name`}>AgentLens workbench</span>
      <header className="agentlens-workbench__header">
        <div className="agentlens-brandline">
          <img className="agentlens-brandmark" src={designAssets.imgLogo} width="24" height="24" alt="" />
          <h1>AgentLens</h1>
        </div>
        {!SINGLE_FETCH_REVIEW && <nav className={`agentlens-primary-nav${activeTab === "auto" && view !== "activity" ? " is-auto-active" : ""}`} aria-label="Main navigation">
          <button type="button" aria-pressed={activeTab !== "auto" && view !== "activity"} onClick={() => { setView("workflows"); setBulkNavigationVersion(value => value + 1); requestTab("single"); }}>{t("nav.single")}</button>
          <button type="button" id={`${panelId}-tab-auto`} aria-pressed={activeTab === "auto" && view !== "activity"} onClick={() => { setView("workflows"); requestTab("auto"); }}>{t("nav.auto")}</button>
        </nav>}
        <div className={`agentlens-account-summary${authState.status !== "signed_in" && !sessionRecovery ? " has-sign-in" : ""}`} aria-label="Account status">
          {authState.status === "signed_in" ? <button type="button" ref={accountTrigger} className="agentlens-account-trigger" aria-label="Account menu" aria-expanded={accountOpen} aria-controls={`${panelId}-account`} onClick={event => { focusAccountOnOpen.current = event.detail === 0; setAccountOpen(!accountOpen); }} onKeyDown={event => {if (event.key === 'ArrowDown') {event.preventDefault(); if (accountOpen) focusFirstAccountAction(); else {focusAccountOnOpen.current = true; setAccountOpen(true);}}}}>
            <strong>{authRestoring ? "Restoring…" : account?.user.name ?? "Account"}</strong><span> · {capabilities?.plan ?? "Connected"} · {account ? `${account.subscription.remainingQuota}/${account.subscription.totalQuota}` : capabilities?.quotaRemaining ?? "—"}</span>
          </button> : sessionRecovery ? <button type="button" disabled>Reconnecting…</button> : <>
            <button type="button" aria-label="Sign in / register" onClick={() => { if (authState.status === "authorizing") void cancelSignIn(); setView("login"); }} disabled={authBusy || (authState.status === "authorizing" && authState.provider !== "google")}>{authRestoring ? "Restoring…" : "Log In"}</button>
            <button type="button" className="mod-cta" onClick={() => { if (authState.status === "authorizing") void cancelSignIn(); setView("register"); }} disabled={authBusy || (authState.status === "authorizing" && authState.provider !== "google")}>Start Free</button>
          </>}
          {onClose && <button type="button" className="agentlens-close" aria-label="Close AgentLens" onClick={onClose}><img src={designAssets.imgMingcuteCloseLine} alt="" width="24" height="24" /></button>}
        </div>
      </header>

      {authState.status === "error" && authState.reason === "credential_unavailable" && <section className="agentlens-device-auth" role="alert">
        <div><strong>Your saved sign-in couldn’t be opened</strong><span>Check Obsidian’s Keychain settings, then retry.</span></div>
        <button type="button" className="mod-cta" onClick={() => void retryRestore()} disabled={authBusy || authRecovering}>Retry saved sign-in</button>
      </section>}
      {sessionRecovery && <section className="agentlens-device-auth agentlens-session-recovery" role="status" aria-label="Session connection">
        <div><strong>{sessionRecovery.attempt >= 3 ? "AgentLens is still unavailable" : "Reconnecting to AgentLens…"}</strong><span>Your saved sign-in and current work are kept. We’ll retry automatically.</span></div>
        <button type="button" onClick={() => void retryRestore()} disabled={authBusy || authRecovering || authRestoring}>{authRecovering ? "Reconnecting…" : "Retry now"}</button>
      </section>}
      {authState.status === "error" && authState.reason !== "credential_unavailable" && authState.reason !== "refresh_unavailable" && authState.provider !== "google" && <section className="agentlens-device-auth" role="alert">
        <div><strong>{`Authorization ${authState.reason === "denied" ? "was denied" : authState.reason === "expired" ? "expired" : "could not be restored"}`}</strong><span>{authState.provider === "email" ? "Enter your email and password again to reconnect this vault." : "The previous code or session will not be reused."}</span></div>
        <button type="button" className="mod-cta" onClick={() => void signOut().then(() => setView("login"))} disabled={authBusy}>{authState.provider === "email" ? "Back to email sign-in" : "Start again"}</button>
      </section>}
      {authError && !sessionRecovery && view !== "login" && view !== "register" && !(view === "workflows" && activeTab === "auto" && authState.status === "signed_in") && <p className="agentlens-inline-error" role="alert">{authError}</p>}
      {capabilities && service && <UpdateNotice
        currentVersion={service.clientVersion()}
        capabilities={capabilities}
        dismissedVersion={uiPreferences.dismissedUpdateVersion}
        preferencesLoaded={preferencesLoaded}
        onDismiss={dismissUpdate}
      />}
      {account && <section ref={accountPanel} id={`${panelId}-account`} hidden={!accountOpen || authState.status !== "signed_in"} className="agentlens-account-details" aria-label="AgentLens account" onBlur={event=>{const next=event.relatedTarget;if(next instanceof window.Node && !event.currentTarget.contains(next) && !accountTrigger.current?.contains(next))setAccountOpen(false);}}>
        <div className="agentlens-plan-card">
          <div className="agentlens-plan-heading"><button type="button" aria-label="Refresh account" title={accountUpdatedAt ? `Last updated ${new Date(accountUpdatedAt).toLocaleString()}. Refresh account` : "Refresh account"} onClick={() => void refreshAccount()} disabled={accountBusy}><strong>{account.subscription.plan} Plan</strong><span>Current Subscription Plan</span></button><span className={`agentlens-plan-status${account.subscription.status === 'active' && !accountStale ? ' is-active' : ''}`}>{accountStale ? 'stale snapshot' : account.subscription.status}</span></div>
          <div className="agentlens-plan-quota"><span>Remaining Quota</span><strong>{account.subscription.remainingQuota} / {account.subscription.totalQuota}</strong></div>
          <progress aria-label="Remaining quota" max={Math.max(account.subscription.totalQuota, 1)} value={Math.max(0, account.subscription.remainingQuota)} />
          <hr />
          <div className="agentlens-plan-detail"><span>Expiry Date</span><span>{account.subscription.periodEnd ? new Date(account.subscription.periodEnd).toLocaleDateString() : account.subscription.plan.toLowerCase() === 'basic' ? 'Never Expires' : '—'}</span></div>
          <div className="agentlens-plan-detail"><span>Quota Reset</span><span>{account.subscription.quotaRefreshAt ? new Date(account.subscription.quotaRefreshAt).toLocaleDateString() : '-'}</span></div>
        </div>
        <nav className="agentlens-account-actions" aria-label="Account actions">
          <a className="agentlens-account-access" href={new URL(account.subscription.billingUrl).origin} target="_blank" rel="noreferrer"><i><img src={accountAssets.imgIconGlyph} alt="" /></i><span>Access AgentLens</span><img src={accountAssets.imgTrailingChevron} alt="" /></a>
          <button type="button" title={account.subscription.fetchAllowed ? 'Manage plan' : billingAction(account.subscription.fetchBlockedReason)} onClick={() => { setAccountOpen(false); setView("plans"); }}><i><img src={accountAssets.imgFrame} alt="" /></i><span>Manage plan</span><img src={accountAssets.imgTrailingChevron} alt="" /></button>
          {!SINGLE_FETCH_REVIEW && <button type="button" hidden onClick={() => { setAccountOpen(false); setShowAccountFollows(true); }}><i><img src={accountAssets.imgFrame} alt="" /></i><span>View account follows</span><img src={accountAssets.imgTrailingChevron} alt="" /></button>}
          <a onClick={event => { if (event.shiftKey && !SINGLE_FETCH_REVIEW) { event.preventDefault(); setDiagnosticOwner(diagnosticScope); } }} className="agentlens-account-support" href="https://agentlensapi.io/support" target="_blank" rel="noopener noreferrer"><i><img src={accountAssets.imgSupport} alt="" /></i><span>Support</span><img src={accountAssets.imgTrailingChevron} alt="" /></a>

          <button type="button" className="agentlens-account-logout" onClick={() => void signOut()} disabled={authBusy}><i><img src={accountAssets.imgIconGlyph1} alt="" /></i><span>Log Out</span><img src={accountAssets.imgTrailingChevron1} alt="" /></button>
        </nav>
      </section>}

      {diagnosticOwner && diagnosticOwner === diagnosticScope && service && <DiagnosticExportDialog key={diagnosticOwner} service={service} onClose={() => setDiagnosticOwner(undefined)} />}
      {!SINGLE_FETCH_REVIEW && showAccountFollows && service && authState.status === "signed_in" && <AccountFollowsDialog service={service} onClose={() => setShowAccountFollows(false)} onUnfollowed={setRemovedFollowId} />}
      {demoAuthOpen && <DemoAuthDialog onCancelBrowserSignIn={()=>void cancelSignIn()} onClose={()=>{void cancelSignIn();setDemoAuthOpen(false);}} busy={authBusy} browserOpening={authBusy} browserPending={authState.status === "authorizing" && authState.provider === "google"} browserError={authError} onSubmit={emailSignIn} onBrowserSignIn={()=>{if(authBusy)return;if(authState.status === "authorizing" && authState.provider === "google")void openAuthorizationPage(authState.authorization.verificationUriComplete ?? authState.authorization.verificationUri);else void beginSignIn("google","sign_up");}} onPasswordReset={async email=>{if(!service?.requestPasswordReset)throw new Error("Password reset is unavailable.");return service.requestPasswordReset(email);}} />}
      {signUpPrompt && <WorkbenchDialog compact iconClose title="Sign up to start free with real links" className="agentlens-signup-prompt" onClose={()=>setSignUpPrompt(false)}>
        <div className="agentlens-dialog-actions"><button type="button" onClick={()=>setSignUpPrompt(false)}>Cancel</button><button type="button" className="mod-cta" onClick={()=>{setSignUpPrompt(false);setView("register");}}>Sign Up</button></div>
      </WorkbenchDialog>}
      {(view === "login" || view === "register") && <EmailAuthPage key={view} mode={view} busy={authBusy || (authState.status === "authorizing" && authState.provider !== "google")} onCancelBrowserSignIn={()=>void cancelSignIn()} browserPending={authState.status === "authorizing" && authState.provider === "google"} browserOpening={authBusy} browserError={authState.status === "error" && authState.provider === "google" ? authState.reason === "expired" ? "Sign-in could not be completed. Start again." : authState.reason === "denied" ? "Sign-in was cancelled. Start again when you’re ready." : "Sign-in could not be completed. Start again." : authError} onBack={()=>{void cancelSignIn();setView("workflows");}} onModeChange={mode=>{void cancelSignIn();setView(mode);}} onPasswordReset={async email=>{if(!service?.requestPasswordReset)throw new Error("Password reset is unavailable.");return service.requestPasswordReset(email);}} onSubmit={async credentials=>{await emailSignIn(credentials);}} onBrowserSignIn={()=>{if(authBusy)return;if(authState.status === "authorizing" && authState.provider === "google")void openAuthorizationPage(authState.authorization.verificationUriComplete ?? authState.authorization.verificationUri);else void beginSignIn("google", view === "register" ? "sign_up" : "sign_in");}} />}
      {!SINGLE_FETCH_REVIEW && view === "activity" && service && <ActivityPane service={service} onBack={() => setView("workflows")} />}
      {view === "plans" && account && <PlanSelectionPage key={account.user.id} accountId={account.user.id} currentPlan={account.subscription.plan} billing={service?.billing} onAccountChanged={refreshAccount} onBack={() => setView("workflows")} />}
      <main ref={workflowBody} className={`agentlens-workbench__body${fittedSingle ? " is-single-preview" : ""}`} hidden={view !== "workflows" || authState.status !== "signed_in" && (authRestoring || Boolean(sessionRecovery))}>
      {activeTab !== "auto" && <>
        <div className="agentlens-pane__intro">
          <p className="agentlens-eyebrow">CAPTURE CONTENT</p>
          <h2>Fetch from social media</h2>
          <p>Choose a task, paste a link, and review the result before saving.</p>
        </div>
        <SupportedPlatforms capabilities={authState.status === "signed_in" ? capabilities : null} publicCatalog={authState.status === "signed_in" ? null : publicCatalog} catalogError={authState.status === "signed_in" ? capabilitiesError : publicCatalogError} mode={activeTab === "bulk" ? "profile" : "single"} />
      </>}
      <div className={`agentlens-import-shell is-${activeTab}${(activeTab === "bulk" && bulkSaveView || activeTab === "single" && singleSaveView) ? " is-save-view" : ""}`} style={{backgroundImage: activeTab === "auto" ? undefined : `url(${activeTab === "bulk" ? importAssets.bulkSurface : importAssets.singleSurface})`}}>
      <nav hidden={activeTab === "auto" || (activeTab === "bulk" && bulkSaveView || activeTab === "single" && singleSaveView)} className="agentlens-tabs" role="tablist" aria-label="AgentLens workflows">
        {WORKBENCH_TABS.filter((tab) => tab.id !== "auto").map((tab) => (
          <button
            key={tab.id}
            id={`${panelId}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-label={t(tabTranslationKey(tab.id))}
            aria-selected={activeTab === tab.id}
            aria-controls={`${panelId}-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            style={activeTab === tab.id ? undefined : {backgroundImage: `url(${activeTab === "bulk" ? importAssets.bulkInactive : importAssets.singleInactive})`}}
            className={activeTab === tab.id ? "is-active" : undefined}
            onClick={() => { if (tab.id === "bulk") setBulkNavigationVersion(value => value + 1); requestTab(tab.id); }}
            onKeyDown={(event) => handleKeyDown(event, tab.id)}
          >
            <strong>{tab.id === "single" ? "Single post fetch" : "Creator profile bulk fetch"}</strong>
            <span>{tab.id === "single" ? "Download media from one work link" : "Import works from one creator page"}</span>
          </button>
        ))}
      </nav>

        <section id={`${panelId}-single`} role="tabpanel" aria-labelledby={`${panelId}-tab-single`} hidden={activeTab !== "single"}><SingleFetchPane onDemoSaved={()=>setDemoAuthOpen(true)} onPreviewChange={setSingleHasPreview} onSaveViewChange={setSingleSaveView} onStartFree={()=>setView("register")} onRequestSignUp={()=>setSignUpPrompt(true)} key={resetVersions.single} initialUrl={initialUrl} service={service} signedIn={authState.status === "signed_in"} capabilities={capabilities} onOpenNote={onOpenNote} defaults={defaults} onAccountChanged={() => void refreshAccount()} onDraftChange={(dirty) => setDraft("single", dirty)} /></section>
        <section id={`${panelId}-bulk`} role="tabpanel" aria-labelledby={`${panelId}-tab-bulk`} hidden={activeTab !== "bulk"}><BulkFetchPane active={activeTab === "bulk" && view === "workflows"} onDemoSaved={()=>setDemoAuthOpen(true)} navigationVersion={bulkNavigationVersion} onStartFree={()=>setView("register")} onRequestSignUp={()=>setSignUpPrompt(true)} onSaveViewChange={setBulkSaveView} key={resetVersions.bulk} service={service} signedIn={authState.status === "signed_in"} capabilities={capabilities} onOpenNote={onOpenNote} defaults={defaults} onAccountChanged={() => void refreshAccount()} onDraftChange={(dirty) => setDraft("bulk", dirty)} /></section>
      </div>
        {!SINGLE_FETCH_REVIEW && <section className="agentlens-auto-tab" id={`${panelId}-auto`} role="tabpanel" aria-labelledby={`${panelId}-tab-auto`} hidden={activeTab !== "auto"}><AutoFetchPane statusError={sessionRecovery ? null : authError} removedFollowId={removedFollowId} onOpenFolder={onOpenFolder} onStartFree={()=>setView("register")} onRequestSignUp={()=>setSignUpPrompt(true)} key={resetVersions.auto} service={service} signedIn={!authRestoring && authState.status === "signed_in"} capabilities={capabilities} capabilitiesError={capabilitiesError} defaults={defaults} onAccountChanged={() => void refreshAccount()} onDraftChange={(dirty) => setDraft("auto", dirty)} /></section>}

      </main>
    </section>
  );
}

function tabTranslationKey(tab: WorkbenchTab): TranslationKey {
  if (tab === "single") return "nav.single";
  if (tab === "bulk") return "nav.bulk";
  return "nav.auto";
}
