import { env } from '../env';
import type { Messages } from './index';

/**
 * Dev sender: logs instead of sending, so everything runs without credentials.
 * Message bodies carry login codes, so they are printed only outside production.
 */
export class DevMessages implements Messages {
  async sms(to: string, text: string) {
    console.log(`[messages:dev] sms to ${to}: ${this.body(text)}`);
  }
  async email({ to, subject, text }: { to: string; subject: string; text: string }) {
    console.log(`[messages:dev] email to ${to} (${subject}): ${this.body(text)}`);
  }
  private body(text: string) {
    return env.NODE_ENV === 'production' ? '[hidden]' : text;
  }
}
