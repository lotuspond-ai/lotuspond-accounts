// A stand-in for Hydra's admin API: it holds login, consent and logout requests and records what Accounts answers.
// The real Hydra is exercised by the end-to-end tests (test-e2e/).
import type { AcceptConsent, AcceptLogin, ConsentRequest, Hydra, LoginRequest, LogoutRequest, Rejection } from '../../src/hydra.ts';
import { HydraError } from '../../src/hydra.ts';

let n = 0;
const challenge = (kind: string) => `${kind}${(++n).toString().padStart(8, '0')}`;

export class FakeHydra implements Hydra {
  logins = new Map<string, LoginRequest>();
  consents = new Map<string, ConsentRequest>();
  logouts = new Map<string, LogoutRequest>();
  accepted: { kind: string; challenge: string; body: unknown }[] = [];
  rejected: { kind: string; challenge: string; body?: Rejection }[] = [];
  revoked: string[] = [];
  isReady = true;

  newLogin(o: Partial<LoginRequest> & { clientId?: string; prompt?: string } = {}): string {
    const c = challenge('login');
    const q = new URLSearchParams({ client_id: o.clientId ?? 'lotuspond-health', ...(o.prompt ? { prompt: o.prompt } : {}) });
    this.logins.set(c, {
      challenge: c, skip: false, subject: '', requested_scope: ['openid', 'email'], session_id: `sid-${c}`,
      request_url: `http://localhost:8080/oauth2/auth?${q}`, ...o, client: { client_id: o.clientId ?? 'lotuspond-health' },
    });
    return c;
  }

  newConsent(o: { subject: string; clientId?: string; scopes?: string[] }): string {
    const c = challenge('consent');
    this.consents.set(c, {
      challenge: c, skip: false, subject: o.subject, client: { client_id: o.clientId ?? 'lotuspond-health' },
      requested_scope: o.scopes ?? ['openid', 'email'], requested_access_token_audience: [], login_session_id: `sid-${c}`,
    });
    return c;
  }

  newLogout(o: { subject: string; sid: string; clientId?: string }): string {
    const c = challenge('logout');
    this.logouts.set(c, { challenge: c, subject: o.subject, sid: o.sid, rp_initiated: true, client: { client_id: o.clientId ?? 'lotuspond-health' } });
    return c;
  }

  private take<T>(map: Map<string, T>, c: string): T {
    const r = map.get(c);
    if (!r) throw new HydraError(404, 'request');
    return r;
  }

  async ready() { return this.isReady; }
  async getLogin(c: string) { return this.take(this.logins, c); }
  async acceptLogin(c: string, body: AcceptLogin) {
    this.take(this.logins, c);
    this.logins.delete(c);
    this.accepted.push({ kind: 'login', challenge: c, body });
    return `http://localhost:8080/oauth2/auth?login_verifier=${c}`;
  }
  async rejectLogin(c: string, body: Rejection) {
    this.take(this.logins, c);
    this.rejected.push({ kind: 'login', challenge: c, body });
    return `https://health.example/callback?error=${body.error}`;
  }
  async getConsent(c: string) { return this.take(this.consents, c); }
  async acceptConsent(c: string, body: AcceptConsent) {
    this.take(this.consents, c);
    this.accepted.push({ kind: 'consent', challenge: c, body });
    return 'https://health.example/callback?code=abc';
  }
  async rejectConsent(c: string, body: Rejection) {
    this.take(this.consents, c);
    this.rejected.push({ kind: 'consent', challenge: c, body });
    return `https://health.example/callback?error=${body.error}`;
  }
  async getLogout(c: string) { return this.take(this.logouts, c); }
  async acceptLogout(c: string) {
    this.take(this.logouts, c);
    this.accepted.push({ kind: 'logout', challenge: c, body: null });
    return 'https://health.example/login';
  }
  async rejectLogout(c: string) {
    this.take(this.logouts, c);
    this.rejected.push({ kind: 'logout', challenge: c });
  }
  async revokeSession(sid: string) { this.revoked.push(sid); }
}
