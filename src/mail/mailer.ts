// Sending email. Production uses Amazon SES in Mumbai. Development and tests keep messages in memory (the outbox),
// shown at /dev/outbox; production refuses the outbox (config.ts). Nothing here logs an address or a link.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

export interface Message { to: string; subject: string; text: string }

export interface Mailer {
  send(message: Message): Promise<void>;
}

/** Development and tests only. Keeps the last 50 messages. */
export class Outbox implements Mailer {
  readonly messages: (Message & { at: Date })[] = [];
  async send(message: Message): Promise<void> {
    this.messages.unshift({ ...message, at: new Date() });
    this.messages.length = Math.min(this.messages.length, 50);
  }
  /** The newest message to an address. */
  latest(to: string): (Message & { at: Date }) | undefined {
    return this.messages.find(m => m.to === to.toLowerCase());
  }
}

export class SesMailer implements Mailer {
  private readonly client: SESv2Client;
  constructor(private readonly from: string, region: string) {
    this.client = new SESv2Client({ region });
  }
  async send(message: Message): Promise<void> {
    await this.client.send(new SendEmailCommand({
      FromEmailAddress: this.from,
      Destination: { ToAddresses: [message.to] },
      Content: { Simple: { Subject: { Data: message.subject, Charset: 'UTF-8' }, Body: { Text: { Data: message.text, Charset: 'UTF-8' } } } },
    }));
  }
}
