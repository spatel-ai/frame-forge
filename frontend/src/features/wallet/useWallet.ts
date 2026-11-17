import { useQuery } from '@tanstack/react-query'
import { getWallet, walletKey } from '../../api/client'

/** The balance. Shared by the top bar pill and the wallet page, so they never disagree. */
export const useWallet = (enabled = true) =>
  useQuery({ queryKey: walletKey, queryFn: getWallet, enabled, refetchOnWindowFocus: true })
