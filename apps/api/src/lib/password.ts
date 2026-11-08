import { hash, verify } from '@node-rs/argon2';

export const hashPassword = (password: string): Promise<string> => hash(password);

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

/** Burns the same time as a real check so unknown emails cannot be told apart by latency. */
export async function verifyDummy(password: string): Promise<void> {
  dummy ??= hash('open-cinema-dummy-password');
  await verifyPassword(await dummy, password);
}
