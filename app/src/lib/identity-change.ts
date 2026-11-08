/**
 * Whether cached data must be dropped when the signed-in user changes. `undefined` is "not seen yet".
 * Nothing user-scoped exists under no session, so null -> user (a guest created at the first seat hold)
 * keeps the cache; user -> other user and user -> null (logout) clear it.
 */
export function shouldClearCache(prev: string | null | undefined, next: string | null): boolean {
  return typeof prev === 'string' && prev !== next;
}
