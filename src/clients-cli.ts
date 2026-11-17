// Register a LotusPond product as an OpenID Connect client: in Hydra (through its admin API, so this runs inside the
// app container) and in the directory's product_clients, which is what lets consent through. Run:
//
//   node dist/clients-cli.js register --product health --client-id lotuspond-health \
//     --redirect-uri https://health.lotuspond.ai/api/auth/accounts/callback \
//     --post-logout-uri https://health.lotuspond.ai/login \
//     --backchannel-logout-uri https://health.lotuspond.ai/api/auth/accounts/backchannel-logout [--public]
//
// Repeat --redirect-uri and --post-logout-uri for each regional host. A confidential client's secret is printed once;
// store it in the product's own secrets, never in a file here.
import { parseArgs } from 'node:util';
import { loadConfig } from './config.ts';
import { openDatabase } from './db/client.ts';
import { productClients } from './db/directory-schema.ts';
import { MIGRATIONS } from './db/databases.ts';

try { process.loadEnvFile('.env'); } catch { /* no .env file */ }

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    product: { type: 'string' },
    'client-id': { type: 'string' },
    'client-name': { type: 'string' },
    'redirect-uri': { type: 'string', multiple: true },
    'post-logout-uri': { type: 'string', multiple: true },
    'backchannel-logout-uri': { type: 'string' },
    public: { type: 'boolean', default: false },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (positionals[0] !== 'register') fail('Usage: clients-cli register --product health|works --client-id ID --redirect-uri URL [...] [--public]');
const product = values.product;
if (product !== 'health' && product !== 'works') fail('--product must be health or works.');
const clientId = values['client-id'];
if (!clientId || !/^[\w.-]{3,100}$/.test(clientId)) fail('--client-id is required: letters, digits, dot, dash or underscore.');
const redirects = values['redirect-uri'] ?? [];
if (!redirects.length) fail('At least one --redirect-uri is required.');
const config = loadConfig();
const httpsOnly = config.env === 'production';
for (const u of [...redirects, ...(values['post-logout-uri'] ?? []), ...(values['backchannel-logout-uri'] ? [values['backchannel-logout-uri']] : [])]) {
  let url: URL;
  try { url = new URL(u); } catch { fail(`Not a URL: ${u}`); }
  if (httpsOnly && url.protocol !== 'https:') fail(`Must use https in production: ${u}`);
  if (url.hash) fail(`A redirect address cannot have a fragment: ${u}`);
}

const client: Record<string, unknown> = {
  client_id: clientId,
  client_name: values['client-name'] ?? (product === 'health' ? 'LotusPond Health' : 'LotusPond Works'),
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  scope: 'openid email profile offline_access lotuspond:region',
  redirect_uris: redirects,
  post_logout_redirect_uris: values['post-logout-uri'] ?? [],
  token_endpoint_auth_method: values.public ? 'none' : 'client_secret_basic',
  subject_type: 'public',
  // Accounts' own consent handler decides; Hydra never shows a consent screen of its own for a product.
  skip_consent: false,
  ...(values['backchannel-logout-uri'] ? { backchannel_logout_uri: values['backchannel-logout-uri'], backchannel_logout_session_required: true } : {}),
};

const res = await fetch(`${config.hydraAdminUrl}/admin/clients`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(client),
});
if (res.status === 409) fail(`A client called ${clientId} already exists in Hydra. Nothing was changed.`);
if (!res.ok) fail(`Hydra refused the client (${res.status}). Nothing was recorded.`);
const created = (await res.json()) as { client_id: string; client_secret?: string };

const directory = await openDatabase({ url: config.directoryDatabaseUrl });
await directory.migrate(MIGRATIONS.directory);
await directory.db.insert(productClients).values({ clientId: created.client_id, product }).onConflictDoUpdate({ target: productClients.clientId, set: { product } });
await directory.close();

console.log(`Registered ${created.client_id} for LotusPond ${product === 'health' ? 'Health' : 'Works'}.`);
if (created.client_secret) console.log(`Client secret (shown once; store it in the product's secrets): ${created.client_secret}`);
