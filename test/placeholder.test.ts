// The placeholder at accounts.lotuspond.ai: one static page, in the design system, with nothing the content security
// policy would block and nothing for search engines to index.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const read = (p: string) => fs.readFileSync(new URL(`../placeholder/${p}`, import.meta.url), 'utf8');

test('the placeholder page carries no inline style or script and is not indexed', () => {
  const page = read('public/index.html');
  assert.doesNotMatch(page, /<script|<style|\sstyle=|\son\w+=/i);
  assert.match(page, /<meta name="robots" content="noindex">/);
  assert.match(page, /href="\/assets\/accounts\.css"/);
  assert.match(read('public/robots.txt'), /Disallow: \//);
  const worker = read('worker.ts');
  assert.match(worker, /default-src 'none'/);
  assert.match(worker, /frame-ancestors 'none'/);
});

test('the placeholder Worker has no storage, secrets or email, and runs on accounts.lotuspond.ai', () => {
  const config = read('wrangler.jsonc');
  assert.doesNotMatch(config, /kv_namespaces|d1_databases|durable_objects|send_email/, 'no storage or email');
  assert.match(config, /"pattern": "accounts\.lotuspond\.ai", "custom_domain": true/);
});
