import { env } from '../env';
import { DevMessages } from './dev';
import { WesendMessages } from './wesend';

export interface Messages {
  sms(to: string, text: string): Promise<void>;
  email(msg: { to: string; subject: string; html: string; text: string }): Promise<void>;
}

export function createMessages(): Messages {
  if (env.MESSAGES_PROVIDER === 'wesend') {
    if (!env.WESEND_API_KEY) throw new Error('MESSAGES_PROVIDER=wesend requires WESEND_API_KEY');
    return new WesendMessages({
      apiKey: env.WESEND_API_KEY,
      fromName: env.WESEND_FROM_NAME,
      replyTo: env.WESEND_REPLY_TO,
    });
  }
  return new DevMessages();
}
