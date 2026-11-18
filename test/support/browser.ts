// A browser for tests: keeps cookies, reads form tokens from pages, and follows nothing on its own, so each
// redirect can be checked. Works against the app in memory (app.request) or a real server (fetch).
export type Requester = (url: string, init: RequestInit) => Promise<Response>;

export class Browser {
  readonly cookies = new Map<string, string>();
  constructor(private readonly send: Requester, readonly origin = 'http://localhost:8080') {}

  private cookieHeader(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private keep(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some(a => /max-age=0\b/i.test(a.trim()) || /expires=thu, 01 jan 1970/i.test(a.trim()));
      if (expired || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async get(path: string): Promise<Response> {
    const res = await this.send(this.url(path), { headers: { cookie: this.cookieHeader() }, redirect: 'manual' });
    this.keep(res);
    return res;
  }

  async post(path: string, fields: Record<string, string>, opts: { origin?: string | null } = {}): Promise<Response> {
    const headers: Record<string, string> = { cookie: this.cookieHeader(), 'content-type': 'application/x-www-form-urlencoded' };
    if (opts.origin !== null) headers.origin = opts.origin ?? this.origin;
    const res = await this.send(this.url(path), { method: 'POST', headers, body: new URLSearchParams(fields).toString(), redirect: 'manual' });
    this.keep(res);
    return res;
  }

  /** Follow redirects that stay on this origin; return the first response that leaves it or is not a redirect. */
  async follow(res: Response, limit = 10): Promise<Response> {
    let current = res;
    for (let i = 0; i < limit && current.status >= 300 && current.status < 400; i++) {
      const location = current.headers.get('location')!;
      const next = new URL(location, this.origin);
      if (next.origin !== this.origin) return current;
      current = await this.get(next.pathname + next.search);
    }
    return current;
  }

  private url(path: string): string {
    return path.startsWith('http') ? path : `${this.origin}${path}`;
  }
}

/** The form token in a page. */
export function csrfOf(page: string): string {
  const m = /name="csrf" value="([^"]+)"/.exec(page);
  if (!m) throw new Error('No form token on the page.');
  return m[1];
}

export function hiddenValue(page: string, name: string): string | undefined {
  return new RegExp(`name="${name}" value="([^"]+)"`).exec(page)?.[1];
}

/** The link in an email's text. */
export function linkIn(text: string): string {
  const m = /(https?:\/\/\S+)/.exec(text);
  if (!m) throw new Error('No link in the email.');
  return m[1];
}
