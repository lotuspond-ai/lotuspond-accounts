import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { SesMailer } from '../src/mail/mailer.ts';
import { loadConfig } from '../src/config.ts';

test('SES mail goes from the configured address through the environment\'s configuration set', async () => {
  const sent: SendEmailCommand[] = [];
  const mailer = new SesMailer('LotusPond Accounts (staging) <accounts@lotuspond.ai>', 'ap-south-1', 'lotuspond-accounts-staging', {
    send: (async (cmd: SendEmailCommand) => { sent.push(cmd); return {}; }) as never,
  });
  await mailer.send({ to: 'asha@example.com', subject: 'Confirm your email for LotusPond', text: 'Hello' });
  const input = sent[0].input;
  assert.equal(input.FromEmailAddress, 'LotusPond Accounts (staging) <accounts@lotuspond.ai>');
  assert.equal(input.ConfigurationSetName, 'lotuspond-accounts-staging');
  assert.deepEqual(input.Destination?.ToAddresses, ['asha@example.com']);
  assert.equal(input.Content?.Simple?.Body?.Text?.Data, 'Hello');
});

test('an empty configuration set from the compose file means none; a malformed one is refused', () => {
  const base = { DIRECTORY_DATABASE_URL: 'postgres://d:x@db:5432/a', CELL_IN_DATABASE_URL: 'postgres://c:x@db:5432/b' };
  assert.equal(loadConfig(base).mail.configurationSet, null);
  assert.equal(loadConfig({ ...base, SES_CONFIGURATION_SET: '' }).mail.configurationSet, null, 'docker compose passes an empty value when it is unset');
  assert.equal(loadConfig({ ...base, SES_CONFIGURATION_SET: 'lotuspond-accounts-staging' }).mail.configurationSet, 'lotuspond-accounts-staging');
  assert.throws(() => loadConfig({ ...base, SES_CONFIGURATION_SET: 'no spaces allowed' }));
});
