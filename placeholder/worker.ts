// The placeholder at accounts.lotuspond.ai (placeholder/README.md). The page, stylesheet and fonts are bundled into the
// Worker, so every path answers without static-asset storage. No storage, secrets or forms.
import page from './public/index.html';
import robots from './public/robots.txt';
import stylesheet from './public/assets/accounts.css';
import atkinson from './public/assets/fonts/atkinson.woff2';
import platypi from './public/assets/fonts/platypi.woff2';

const security = {
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const files: Record<string, { body: string | ArrayBuffer; type: string; cache: string }> = {
  '/robots.txt': { body: robots, type: 'text/plain; charset=utf-8', cache: 'public, max-age=3600' },
  '/assets/accounts.css': { body: stylesheet, type: 'text/css; charset=utf-8', cache: 'public, max-age=3600' },
  '/assets/fonts/atkinson.woff2': { body: atkinson, type: 'font/woff2', cache: 'public, max-age=31536000, immutable' },
  '/assets/fonts/platypi.woff2': { body: platypi, type: 'font/woff2', cache: 'public, max-age=31536000, immutable' },
};

export default {
  fetch(request: Request): Response {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Not open yet.', { status: 405, headers: { ...security, Allow: 'GET, HEAD' } });
    }
    const file = files[new URL(request.url).pathname];
    const { body, type, cache } = file ?? { body: page, type: 'text/html; charset=utf-8', cache: 'no-cache' };
    return new Response(request.method === 'HEAD' ? null : body, { headers: { ...security, 'Content-Type': type, 'Cache-Control': cache } });
  },
};
