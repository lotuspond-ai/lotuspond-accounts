// The emails Accounts sends. Plain text: it reads everywhere, and a link is the only thing in it to act on.
import type { Message } from './mailer.ts';

export function verifyEmail(to: string, name: string, link: string): Message {
  return {
    to,
    subject: 'Confirm your email for LotusPond',
    text: [
      `Hello ${name},`,
      '',
      'Confirm that this is your email address for your LotusPond account:',
      '',
      link,
      '',
      'The link works once, for 24 hours.',
      '',
      'If you did not create a LotusPond account, you can ignore this email. Nothing happens unless the link is opened and confirmed.',
      '',
      'LotusPond Accounts',
    ].join('\n'),
  };
}

export function accountExists(to: string, name: string, signInLink: string, resetLink: string): Message {
  return {
    to,
    subject: 'You already have a LotusPond account',
    text: [
      `Hello ${name},`,
      '',
      'Someone tried to create a LotusPond account with this email address. You already have one, so no new account was made.',
      '',
      'To sign in:',
      signInLink,
      '',
      'If you forgot your password, choose a new one:',
      resetLink,
      '',
      'If this was not you, ignore this email. Your account is unchanged.',
      '',
      'LotusPond Accounts',
    ].join('\n'),
  };
}

export function resetPassword(to: string, name: string, link: string): Message {
  return {
    to,
    subject: 'Reset your LotusPond password',
    text: [
      `Hello ${name},`,
      '',
      'Someone asked to reset the password of your LotusPond account. To choose a new one, open:',
      '',
      link,
      '',
      'The link works once, for 30 minutes. Choosing a new password signs you out everywhere, in every LotusPond product.',
      '',
      'If you did not ask for this, ignore this email. Your password stays as it is.',
      '',
      'LotusPond Accounts',
    ].join('\n'),
  };
}
