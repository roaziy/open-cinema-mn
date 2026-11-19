import { useQuery } from '@tanstack/react-query';
import { type MyPoints, MyPointsSchema } from '@/shared';
import { api } from './api';
import { useAuth } from './auth';

export const loyaltyKeys = { points: ['me', 'points'] as const };

/** Balance, member number and the latest entries; only for a signed-in customer. */
export function useMyPoints() {
  const { user } = useAuth();
  return useQuery({
    queryKey: loyaltyKeys.points,
    queryFn: async (): Promise<MyPoints> => MyPointsSchema.parse(await api('/me/points')),
    enabled: user?.role === 'customer',
  });
}
