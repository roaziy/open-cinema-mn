import { Directory, File, Paths } from 'expo-file-system';
import { getUserId } from './auth';
import { type CacheFs, createTicketStore } from './ticket-store';

/** Files live in the app's document directory: kept across restarts, never in the OS-managed cache. */
const dir = () => new Directory(Paths.document, 'ticket-cache');

const fs: CacheFs = {
  list: () => {
    const d = dir();
    return d.exists
      ? d
          .list()
          .filter((e): e is File => e instanceof File)
          .map((f) => f.name)
      : [];
  },
  read: async (name) => {
    const f = new File(dir(), name);
    return f.exists ? f.text() : null;
  },
  write: (name, content) => {
    dir().create({ intermediates: true, idempotent: true });
    const f = new File(dir(), name);
    f.create({ overwrite: true, intermediates: true });
    f.write(content);
  },
  remove: (name) => {
    const f = new File(dir(), name);
    if (f.exists) f.delete();
  },
  removeAll: () => {
    const d = dir();
    if (d.exists) d.delete();
  },
};

const store = createTicketStore(fs, getUserId);

export const loadCache = store.load;
export const saveList = store.saveList;
export const saveTicket = store.saveTicket;
export const clearTicketCache = store.clear;
/** Call once the signed-in user is known (null: nobody), and the cache keeps no one else's files. */
export const sweepTicketCache = store.sweep;
