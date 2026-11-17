import { useQuery } from '@tanstack/react-query'
import { Link, Outlet } from 'react-router'
import { getConfig } from '../api/client'
import type { Config } from '../api/client'
import { useMe } from '../lib/session'
import { useWallet } from '../lib/wallet'
import { errMsg } from '../lib/util'
import { Banner, CreditsPill } from './feedback'
import { BottomNav, Sidebar, TopBar } from './shell'
import styles from './AppShell.module.css'

const RETRY_MS = 3000

export type ShellContext = { config: Config | null; configError: string | null }

export default function AppShell() {
  const query = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // While the configuration has not loaded, try again every few seconds.
    refetchInterval: (q) => (q.state.data ? false : RETRY_MS),
    refetchIntervalInBackground: true,
  })
  const { data: me } = useMe()
  const wallet = useWallet(!!me)
  const config = query.data ?? null
  const configError = query.error && !config ? errMsg(query.error) : null

  const context: ShellContext = { config, configError }

  return (
    <div className={styles.shell}>
      <a href="#content" className={styles.skip}>Skip to content</a>
      <Sidebar />
      <div className={styles.column}>
        <TopBar mockMode={config?.provider === 'mock'} razorpayPayments={config?.payments === 'razorpay'}>
          {me && !wallet.isError && (
            <>
              <Link to="/wallet" className={styles.pillLink}>
                <CreditsPill balance={wallet.data?.available_credits} loading={wallet.isPending} />
              </Link>
              <Link to="/wallet?buy=1" className={styles.buyLink}>Buy credits</Link>
            </>
          )}
          {me && <span className={styles.userName}>{me.name}</span>}
        </TopBar>
        <main id="content" tabIndex={-1} className={styles.content}>
          <Banner tone="info" title="Internal testing only">
            Use only a photo of yourself, or of someone who has agreed. The output is AI-generated.
          </Banner>
          <Outlet context={context} />
        </main>
      </div>
      <BottomNav />
    </div>
  )
}
