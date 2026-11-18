// Ory Hydra's admin API: the login, consent and logout requests Accounts answers, and revoking login sessions. The
// admin API is reachable only on the private Docker network (deploy/README.md). Hydra's own error text never reaches a
// person: callers get HydraError with a status, and pages say what to do instead.

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface HydraClient {
  client_id: string;
  client_name?: string;
}

export interface LoginRequest {
  challenge: string;
  skip: boolean;
  /** The account, when skip is true. */
  subject: string;
  client: HydraClient;
  requested_scope: string[];
  request_url: string;
  /** The Hydra login session: becomes `sid` in ID tokens. */
  session_id?: string;
  oidc_context?: { login_hint?: string; ui_locales?: string[] };
}

export interface ConsentRequest {
  challenge: string;
  skip: boolean;
  subject: string;
  client: HydraClient;
  requested_scope: string[];
  requested_access_token_audience: string[];
  login_session_id?: string;
  context?: Record<string, unknown>;
  amr?: string[];
}

export interface LogoutRequest {
  challenge: string;
  subject: string;
  sid: string;
  rp_initiated: boolean;
  client?: HydraClient | null;
}

export interface AcceptLogin {
  subject: string;
  remember: boolean;
  remember_for: number;
  amr: string[];
  context?: Record<string, unknown>;
}

export interface AcceptConsent {
  grant_scope: string[];
  grant_access_token_audience: string[];
  remember: boolean;
  remember_for: number;
  session: { id_token: Record<string, unknown>; access_token?: Record<string, unknown> };
}

export interface Rejection {
  error: 'access_denied' | 'login_required' | 'invalid_request' | 'server_error';
  error_description: string;
}

export class HydraError extends Error {
  constructor(readonly status: number, readonly what: string) {
    super(`Hydra ${what} answered ${status}`);
  }
}

export interface Hydra {
  ready(): Promise<boolean>;
  getLogin(challenge: string): Promise<LoginRequest>;
  acceptLogin(challenge: string, body: AcceptLogin): Promise<string>;
  rejectLogin(challenge: string, body: Rejection): Promise<string>;
  getConsent(challenge: string): Promise<ConsentRequest>;
  acceptConsent(challenge: string, body: AcceptConsent): Promise<string>;
  rejectConsent(challenge: string, body: Rejection): Promise<string>;
  getLogout(challenge: string): Promise<LogoutRequest>;
  acceptLogout(challenge: string): Promise<string>;
  rejectLogout(challenge: string): Promise<void>;
  /** Revoke one login session. Hydra sends back-channel logout to every product signed in from it. */
  revokeSession(sid: string): Promise<void>;
}

/**
 * A challenge is opaque to Accounts, but never empty and never huge. Hydra v26 carries the whole flow inside it
 * (about 1,200 characters), sometimes with base64 `=` padding.
 */
export const isChallenge = (value: unknown): value is string => typeof value === 'string' && /^[\w.~=-]{8,8192}$/.test(value);

export function hydraAdmin(adminUrl: string, fetchImpl: Fetch = fetch): Hydra {
  const base = `${adminUrl}/admin/oauth2/auth`;

  async function call<T>(what: string, method: 'GET' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Hydra down, restarting or too slow: callers show "not available", not an unexpected error.
      throw new HydraError(503, what);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new HydraError(res.status, what);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  const redirect = async (what: string, path: string, body: unknown) =>
    (await call<{ redirect_to: string }>(what, 'PUT', path, body)).redirect_to;

  const q = (name: string, challenge: string) => `?${name}_challenge=${encodeURIComponent(challenge)}`;

  return {
    ready: async () => {
      try {
        const res = await fetchImpl(`${adminUrl}/health/ready`, { signal: AbortSignal.timeout(3_000) });
        await res.body?.cancel();
        return res.ok;
      } catch {
        return false;
      }
    },
    getLogin: c => call('login request', 'GET', `/requests/login${q('login', c)}`),
    acceptLogin: (c, b) => redirect('login accept', `/requests/login/accept${q('login', c)}`, b),
    rejectLogin: (c, b) => redirect('login reject', `/requests/login/reject${q('login', c)}`, b),
    getConsent: c => call('consent request', 'GET', `/requests/consent${q('consent', c)}`),
    acceptConsent: (c, b) => redirect('consent accept', `/requests/consent/accept${q('consent', c)}`, b),
    rejectConsent: (c, b) => redirect('consent reject', `/requests/consent/reject${q('consent', c)}`, b),
    getLogout: c => call('logout request', 'GET', `/requests/logout${q('logout', c)}`),
    acceptLogout: c => redirect('logout accept', `/requests/logout/accept${q('logout', c)}`, {}),
    rejectLogout: async c => { await call('logout reject', 'PUT', `/requests/logout/reject${q('logout', c)}`, {}); },
    revokeSession: async sid => { await call('session revoke', 'DELETE', `/sessions/login?sid=${encodeURIComponent(sid)}`); },
  };
}
