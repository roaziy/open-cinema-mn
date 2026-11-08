import { type PublicUser, PublicUserSchema } from '@open-cinema/shared';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { api } from './api';
import { getUserId, subscribeAuth } from './auth';
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
  if (lastUserId !== undefined && id !== lastUserId) {
    queryClient.clear();
    // Stored tickets belong to one account too.
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
