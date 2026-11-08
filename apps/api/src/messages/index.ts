import { env } from '../env';

export interface Messages {
  sms(to: string, text: string): Promise<void>;
  email(msg: { to: string; subject: string; html: string; text: string }): Promise<void>;
}

/** Dev sender: logs instead of sending, so everything runs without credentials. */
export class DevMessages implements Messages {
  async sms(to: string, text: string) {
    console.log(`[messages:dev] sms to ${to}: ${text}`);
  }
  async email({ to, subject, text }: { to: string; subject: string; text: string }) {
    console.log(`[messages:dev] email to ${to} (${subject}): ${text}`);
  }
}

export function createMessages(): Messages {
  // The wesend sender arrives in a later task; until then every provider logs.
  if (env.MESSAGES_PROVIDER === 'wesend') console.warn('[messages] wesend not implemented yet');
  return new DevMessages();
}
