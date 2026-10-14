import type { DeviceAuthorization, DevicePollResult } from "../api/contracts";
import { RequestCoordinator } from "../runtime/RequestCoordinator";
import { AgentLensError } from "../core/errors";

export interface EmailCredentials { email: string; password: string; name?: string; turnstileToken?: string; }
export type DeviceAuthorizationIntent = "sign_in" | "sign_up";
export const OBSIDIAN_PLUGIN_CLIENT_TYPE = "obsidian_plugin";

export interface AuthApi {
  registrationRequirements?(): Promise<{humanVerificationRequired: boolean}>;
  authenticateEmail?(credentials: EmailCredentials): Promise<string>;
  approveDevice?(webToken: string, userCode: string): Promise<void>;
  startDeviceAuthorization(): Promise<DeviceAuthorization>;
  pollDeviceAuthorization(deviceCode: string): Promise<DevicePollResult>;
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number; refreshToken?: string | undefined }>;
  revoke(refreshToken: string): Promise<void>;
}

export interface RefreshTokenPersistence {
  load(): Promise<string | null>;
  save(refreshToken: string): Promise<void>;
  clear(): Promise<void>;
}

export type AuthState =
  | { status: "signed_out" }
  | { status: "authorizing"; authorization: DeviceAuthorization; expiresAt: number; nextPollAt: number; clientType?: typeof OBSIDIAN_PLUGIN_CLIENT_TYPE | undefined; provider?: "google" | "email" | undefined }
  | { status: "signed_in"; accessToken: string; accessTokenExpiresAt: number; clientType?: typeof OBSIDIAN_PLUGIN_CLIENT_TYPE | undefined }
  | { status: "error"; reason: "denied" | "expired" | "refresh_failed" | "refresh_unavailable" | "credential_unavailable"; provider?: "google" | "email" | undefined };

export class AuthService {
  private state: AuthState = { status: "signed_out" };
  private readonly requests = new RequestCoordinator();
  private operations: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private signingOut = false;
  private starting = false;
  private verification?: AbortController | undefined;
  private readonly listeners = new Set<(state: Readonly<AuthState>) => void>();

  constructor(
    private readonly api: AuthApi,
    private readonly refreshTokens: RefreshTokenPersistence,
    private readonly now: () => number = () => Date.now(),
    private readonly verifyHuman?: ((signal: AbortSignal) => Promise<string>) | undefined
  ) {}

  snapshot(): Readonly<AuthState> {
    return this.state;
  }

  subscribe(listener: (state: Readonly<AuthState>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async restore(): Promise<AuthState> {
    if (this.state.status === "authorizing" || this.starting || this.signingOut) return this.state;
    try {
      return await this.refreshSession();
    } catch {
      return this.state;
    }
  }

  start(provider?: "google", intent: DeviceAuthorizationIntent = "sign_in"): Promise<AuthState> {
    this.verification?.abort();
    return this.requests.runExclusive("auth:start", () => {
      const generation = ++this.generation;
      this.starting = true;
      return this.serialize(async () => {
        if (generation !== this.generation) return this.state;
        const authorization = await this.api.startDeviceAuthorization();
        if (generation !== this.generation) return this.state;
        if (provider) {
          if (!authorization.googleAuthorizationUrl) {
            throw new Error("Google sign-in is temporarily unavailable. Please try again later.");
          }
          const url = new URL(authorization.googleAuthorizationUrl);
          const verification = new URL(authorization.verificationUri);
          if (url.origin !== verification.origin || url.pathname !== "/api/auth/oauth/google/start"
              || !url.searchParams.get("pluginTicket") || url.username || url.password) {
            throw new Error("Invalid Google sign-in URL.");
          }
          authorization.verificationUriComplete = url.toString();
        }
        const now = this.now();
        return this.setState({
          status: "authorizing",
          authorization,
          provider,
          ...(provider ? { clientType: OBSIDIAN_PLUGIN_CLIENT_TYPE } : {}),
          expiresAt: now + authorization.expiresIn * 1000,
          nextPollAt: now + authorization.interval * 1000
        });
      }).finally(() => { this.starting = false; });
    });
  }

  startWithEmail(credentials: EmailCredentials): Promise<AuthState> {
    if (!this.api.authenticateEmail || !this.api.approveDevice) return Promise.reject(new Error("Email sign-in is unavailable."));
    return this.requests.runExclusive("auth:email", () => {
      const generation = ++this.generation;
      this.starting = true;
      return this.serialize(async () => {
        if (generation !== this.generation) return this.state;
        // Web credentials authorize this installation; only the scoped plugin refresh token is persisted.
        let submitted = credentials;
        if (credentials.name !== undefined && this.api.registrationRequirements) {
          const requirements = await this.api.registrationRequirements();
          if (generation !== this.generation) return this.state;
          if (requirements.humanVerificationRequired) {
            if (!this.verifyHuman) throw new Error("Human verification is unavailable in this host.");
            const verification = new AbortController();
            this.verification = verification;
            try { submitted = {...credentials, turnstileToken: await this.verifyHuman(verification.signal)}; }
            finally { if (this.verification === verification) this.verification = undefined; }
            if (generation !== this.generation) return this.state;
          }
        }
        const webToken = await this.api.authenticateEmail!(submitted);
        if (generation !== this.generation) return this.state;
        const authorization = await this.api.startDeviceAuthorization();
        if (generation !== this.generation) return this.state;
        await this.api.approveDevice!(webToken, authorization.userCode);
        if (generation !== this.generation) return this.state;
        const now = this.now();
        // The web token has already approved this device. Poll once immediately;
        // only a pending response needs the normal server-provided interval.
        return this.setState({status: "authorizing", provider: "email", clientType: OBSIDIAN_PLUGIN_CLIENT_TYPE, authorization, expiresAt: now + authorization.expiresIn * 1000, nextPollAt: now});
      }).finally(() => { this.starting = false; });
    });
  }

  async pollOnce(): Promise<AuthState> {
    if (this.state.status !== "authorizing" || this.signingOut) return this.state;
    const generation = this.generation;
    return this.requests.runExclusive(`auth:device-poll:${generation}`, () => this.serialize(async () => {
      if (generation !== this.generation || this.state.status !== "authorizing") return this.state;
      const current = this.state;
      if (this.now() >= current.expiresAt) return this.setState({ status: "error", reason: "expired", ...(current.provider ? {provider: current.provider} : {}) });
      if (this.now() < current.nextPollAt) return this.state;
      let result: DevicePollResult;
      try {
        result = await this.api.pollDeviceAuthorization(current.authorization.deviceCode);
      } catch (error) {
        if (generation !== this.generation) return this.state;
        if (error instanceof AgentLensError && error.status === 400) {
          return this.setState({ status: "error", reason: "expired", ...(current.provider ? {provider: current.provider} : {}) });
        }
        // Publish a new deadline so the UI schedules another poll after a transient failure.
        this.setState({ ...current, nextPollAt: this.now() + Math.max(5, current.authorization.interval) * 1000 });
        throw error;
      }
      // Retain newly issued credentials until a queued logout can revoke them.
      if (result.status === "authorized") await this.refreshTokens.save(result.refreshToken);
      if (generation !== this.generation) return this.state;
      if (result.status === "denied" || result.status === "expired") {
        return this.setState({ status: "error", reason: result.status, ...(current.provider ? {provider: current.provider} : {}) });
      }
      if (result.status === "authorized") {
        return this.setState({
          status: "signed_in",
          accessToken: result.accessToken,
          accessTokenExpiresAt: this.now() + result.expiresIn * 1000,
          ...(current.clientType ? { clientType: current.clientType } : {})
        });
      }
      const interval = result.interval ?? current.authorization.interval;
      return this.setState({ ...current, nextPollAt: this.now() + interval * 1000 });
    }));
  }

  async accessToken(): Promise<string | null> {
    if (this.signingOut || this.starting || this.state.status === "authorizing") return null;
    const state = await this.refreshSession();
    return state.status === "signed_in" ? state.accessToken : null;
  }

  cancelPendingSignIn(): Promise<void> {
    return this.starting || this.state.status === "authorizing" ? this.signOut() : Promise.resolve();
  }

  signOut(): Promise<void> {
    return this.requests.runExclusive("auth:logout", () => {
      ++this.generation;
      this.verification?.abort();
      this.signingOut = true;
      this.setState({ status: "signed_out" });
      return this.serialize(async () => {
        try {
          const refreshToken = await this.refreshTokens.load();
          if (refreshToken) await this.api.revoke(refreshToken);
        } finally {
          await this.refreshTokens.clear();
        }
      }).finally(() => { this.signingOut = false; });
    });
  }

  private async refreshSession(): Promise<AuthState> {
    if (this.state.status === "signed_in" && this.state.accessTokenExpiresAt - this.now() > 30_000) {
      return this.state;
    }
    const generation = this.generation;
    return this.requests.runExclusive(`auth:refresh:${generation}`, () => this.serialize(async () => {
      if (generation !== this.generation || this.signingOut || this.starting) return this.state;
      let token: string | null;
      try {
        token = await this.refreshTokens.load();
      } catch (error) {
        if (generation !== this.generation || this.signingOut) return this.state;
        this.setState({ status: "error", reason: "credential_unavailable" });
        throw error;
      }
      if (generation !== this.generation) return this.state;
      if (!token) return this.setState({ status: "signed_out" });
      try {
        const result = await this.api.refresh(token);
        // Logout runs after this operation and must revoke the latest rotated token.
        if (result.refreshToken) await this.refreshTokens.save(result.refreshToken);
        if (generation !== this.generation) return this.state;
        return this.setState({
          status: "signed_in",
          accessToken: result.accessToken,
          accessTokenExpiresAt: this.now() + result.expiresIn * 1000,
          clientType: OBSIDIAN_PLUGIN_CLIENT_TYPE
        });
      } catch (error) {
        if (generation !== this.generation) return this.state;
        if (invalidRefreshCredential(error)) {
          await this.refreshTokens.clear();
          if (generation !== this.generation) return this.state;
          this.setState({ status: "error", reason: "refresh_failed" });
          throw error;
        }
        this.setState({ status: "error", reason: "refresh_unavailable" });
        throw error;
      }
    }));
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation);
    this.operations = result.catch(() => undefined);
    return result;
  }

  private setState<T extends AuthState>(state: T): T {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
    return state;
  }
}

function invalidRefreshCredential(error: unknown): boolean {
  if (error instanceof AgentLensError) {
    return error.code === "auth_required" || error.code === "forbidden" || error.status === 400;
  }
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return candidate.code === "auth_required"
    || candidate.code === "forbidden"
    || candidate.status === 400
    || candidate.status === 401
    || candidate.status === 403;
}
