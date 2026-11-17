import type { QueryClient } from '@tanstack/react-query'
import { walletKey } from '../../api/client'

/** Refetch the balance and the transactions (they share the `walletKey` prefix). Call after anything that can charge. */
export const invalidateWallet = (queryClient: QueryClient) => queryClient.invalidateQueries({ queryKey: walletKey })
