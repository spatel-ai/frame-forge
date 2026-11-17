import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Outlet } from 'react-router'
import { getConfig } from '../api/client'
import type { Config } from '../api/client'
import { useMe } from '../lib/session'
import { useWallet } from '../lib/wallet'
import { errMsg } from '../lib/util'
import { Banner, CreditsPill } from './feedback'
import { BottomNav, Sidebar, TopBar, usePageTitle } from './shell'
import styles from './AppShell.module.css'

const RETRY_MS = 3000

export type ShellContext = { config: Config | null; configError: string | null }

export default function AppShell() {
  usePageTitle()

  // Phones: a focused control that is partly under the fixed bottom bar is scrolled clear of it. The
  // browser only does this when the control is wholly hidden; scroll-margin (base.css) sets the gap.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target
      if (!(el instanceof HTMLElement) || typeof window.matchMedia !== 'function') return
      if (!window.matchMedia('(max-width: 767px)').matches || el.closest('nav, dialog')) return
      requestAnimationFrame(() => el.scrollIntoView?.({ block: 'nearest' }))
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])
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
          {me && <span className={styles.userName} title={me.name}>{me.name}</span>}
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
