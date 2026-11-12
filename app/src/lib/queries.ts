import { QueryClient, useQuery } from '@tanstack/react-query';
import { type PublicUser, PublicUserSchema } from '@/shared';
import { api } from './api';
import { getUserId, subscribeAuth } from './auth';
import { shouldClearCache } from './identity-change';
import { clearTicketCache } from './ticket-cache';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

// Cached data belongs to one identity: drop it whenever the signed-in user changes.
let lastUserId: string | null | undefined;
subscribeAuth(() => {
  const id = getUserId();
  if (shouldClearCache(lastUserId, id)) {
    // Stop ticket reads that began under the old identity, then drop them and the stored copies.
    void queryClient.cancelQueries({ queryKey: ['ticket'] });
    void queryClient.cancelQueries({ queryKey: ['tickets'] });
    queryClient.clear();
    void clearTicketCache();
  }
  lastUserId = id;
});

export const queryKeys = {
  me: ['me'] as const,
};

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async (): Promise<PublicUser> => PublicUserSchema.parse(await api('/me')),
  });
}
