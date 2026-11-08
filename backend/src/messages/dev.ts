import { env } from '../env';
import type { Messages } from './index';

/**
 * Dev sender: logs instead of sending, so everything runs without credentials.
 * Messages carry login codes, so in production only the recipient is logged.
 */
export class DevMessages implements Messages {
  constructor(private readonly hideContent = env.NODE_ENV === 'production') {}

  async sms(to: string, text: string) {
    console.log(`[messages:dev] sms to ${to}${this.hideContent ? '' : `: ${text}`}`);
  }
  async email({ to, subject, text }: { to: string; subject: string; text: string }) {
    console.log(`[messages:dev] email to ${to}${this.hideContent ? '' : ` (${subject}): ${text}`}`);
  }
}
