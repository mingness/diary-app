/**
 * Outgoing email (D27). Only admin alert emails, only when SMTP is configured. Behind an interface so tests use
 * a fake and never send anything.
 */
import nodemailer from 'nodemailer';

export interface MailMessage {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export function createSmtpMailer(smtp: { url: string; from: string }): Mailer {
  const transport = nodemailer.createTransport(smtp.url);
  return {
    async send(message) {
      // Recipients go in BCC so admins don't see each other's addresses.
      await transport.sendMail({
        from: smtp.from,
        to: smtp.from,
        bcc: [...message.to],
        subject: message.subject,
        text: message.text,
      });
    },
  };
}

/** Collects messages instead of sending them; optionally fails, to test retries. */
export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  failWith: Error | null = null;

  async send(message: MailMessage): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
  }
}
