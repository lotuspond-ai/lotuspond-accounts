// The deployment's safety properties, checked from the files themselves so a later edit cannot quietly undo them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const read = (p: string) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
type Service = { image?: string; ports?: unknown[]; networks?: string[] | Record<string, { ipv4_address?: string } | null>; command?: string[] };
const compose = parse(read('deploy/docker-compose.yml')) as { services: Record<string, Service>; networks: Record<string, { internal?: boolean; ipam?: { config: { subnet: string }[] } }> };
const hydraConfig = parse(read('deploy/hydra.yml'));
const networksOf = (s: Service) => (Array.isArray(s.networks) ? s.networks : Object.keys(s.networks ?? {}));

test('only Caddy publishes ports', () => {
  for (const [name, s] of Object.entries(compose.services)) {
    if (name !== 'caddy') assert.equal(s.ports, undefined, `${name} must not publish ports`);
  }
});

test("Hydra's admin API listens only on its fixed address in the private admin network", () => {
  const hydra = compose.services.hydra;
  const admin = (hydra.networks as Record<string, { ipv4_address?: string }>).admin;
  assert.equal(admin.ipv4_address, hydraConfig.serve.admin.host);
  assert.equal(compose.networks.admin.internal, true);
  const subnet = compose.networks.admin.ipam!.config[0].subnet;
  assert.ok(hydraConfig.serve.admin.host.startsWith(subnet.split('.').slice(0, 3).join('.')), 'admin host must be inside the admin subnet');
});

test('only the app and Hydra join the admin network; Caddy is on the edge network only', () => {
  const onAdmin = Object.entries(compose.services).filter(([, s]) => networksOf(s).includes('admin')).map(([n]) => n).sort();
  assert.deepEqual(onAdmin, ['app', 'hydra']);
  assert.deepEqual(networksOf(compose.services.caddy), ['edge']);
  assert.equal(compose.networks.data.internal, true);
  assert.deepEqual(networksOf(compose.services.db), ['data']);
});

test('Hydra trusts forwarded TLS only from the edge network', () => {
  assert.deepEqual(hydraConfig.serve.public.tls.allow_termination_from, [compose.networks.edge.ipam!.config[0].subnet]);
});

test('every third-party image is pinned by digest', () => {
  for (const [name, s] of Object.entries(compose.services)) {
    if (s.image) assert.match(s.image, /@sha256:[0-9a-f]{64}$/, `${name} image must be pinned by digest`);
  }
  for (const line of read('Dockerfile').split('\n').filter(l => l.startsWith('FROM '))) {
    assert.match(line, /@sha256:[0-9a-f]{64}/);
  }
});

test('Hydra enforces PKCE, hides internal errors, never logs secrets and sends no telemetry', () => {
  assert.equal(hydraConfig.oauth2.pkce.enforced, true);
  assert.equal(hydraConfig.oauth2.expose_internal_errors, false);
  assert.equal(hydraConfig.log.leak_sensitive_values, false);
  assert.equal(hydraConfig.oidc.dynamic_client_registration.enabled, false);
  assert.ok(compose.services.hydra.command!.includes('--sqa-opt-out'));
  assert.ok(!compose.services.hydra.command!.includes('--dev'), '--dev belongs only in docker-compose.local.yml');
});

test('Caddy sends only the OpenID Connect endpoints to Hydra, and never its admin API', () => {
  for (const file of ['deploy/Caddyfile', 'deploy/Caddyfile.local']) {
    const text = read(file);
    assert.match(text, /@hydra path \/oauth2\/\* \/userinfo \/\.well-known\/openid-configuration \/\.well-known\/jwks\.json\n/);
    assert.doesNotMatch(text, /4445|\/admin/);
  }
});

test('no secret is written into the compose file or the Hydra config', () => {
  assert.doesNotMatch(read('deploy/docker-compose.yml'), /PASSWORD: [^$\s]|SECRETS_\w+: [^$\s]/);
  assert.equal(hydraConfig.secrets, undefined);
  assert.equal(hydraConfig.dsn, undefined);
});

test('Hydra\'s issuer and pages follow DOMAIN, the same as the app\'s public address', () => {
  const env = (compose.services.hydra as unknown as { environment: Record<string, string> }).environment;
  const app = (compose.services.app as unknown as { environment: Record<string, string> }).environment;
  const base = 'https://${DOMAIN:-accounts.lotuspond.ai}';
  assert.equal(app.PUBLIC_URL, base);
  assert.equal(env.URLS_SELF_ISSUER, base);
  assert.equal(env.URLS_SELF_PUBLIC, base);
  for (const [k, path] of [['URLS_LOGIN', '/login'], ['URLS_CONSENT', '/consent'], ['URLS_LOGOUT', '/logout'], ['URLS_ERROR', '/error'], ['URLS_POST_LOGOUT_REDIRECT', '/signed-out']]) {
    assert.equal(env[k], base + path, k);
  }
});
