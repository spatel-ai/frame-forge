import { useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { getWallet, walletKey } from '../api/client'

/** The balance. Shared by the top bar pill and the wallet page, so they never disagree. */
export const useWallet = (enabled = true) =>
  useQuery({ queryKey: walletKey, queryFn: getWallet, enabled, refetchOnWindowFocus: true })

/** Refetch the balance and the transactions (they share the `walletKey` prefix). Call after anything that can charge. */
export const invalidateWallet = (queryClient: QueryClient) => queryClient.invalidateQueries({ queryKey: walletKey })
