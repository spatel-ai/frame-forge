import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router'
import { getTransactions, transactionsKey } from '../../api/client'
import type { ShellContext } from '../../components/AppShell'
import type { LedgerEntry } from '../../api/client'
import { EmptyState, ErrorState, Skeleton, SkeletonGroup } from '../../components/feedback'
import { Button } from '../../components/form'
import { CoinIcon } from '../../components/icons'
import { Card, Pagination } from '../../components/layout'
import { errMsg } from '../../lib/util'
import { BuyCreditsDialog } from './BuyCreditsDialog'
import { safeReturnPath } from '../../lib/returnPath'
import { useWallet } from '../../lib/wallet'
import styles from './WalletPage.module.css'

const PAGE_SIZE = 20
const credits = new Intl.NumberFormat('en-IN')
const signed = new Intl.NumberFormat('en-IN', { signDisplay: 'exceptZero' })
const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

const DESCRIPTIONS: Record<LedgerEntry['kind'], string> = {
  grant: 'Credits added',
  purchase: 'Credits bought',
  voice_charge: 'Voice generated',
  voice_return: 'Voice failed, credits returned',
  hold: 'Reserved for a video',
  capture: 'Video delivered',
  release: 'Video failed, credits returned',
  adjustment: 'Adjustment',
  refund: 'Refund',
}

/** Hold and release change `reserved`, not the balance, so the server's `reserved_delta` is shown. */
function Change({ entry }: { entry: LedgerEntry }) {
  if (entry.kind === 'hold' || entry.kind === 'release') {
    const amount = credits.format(Math.abs(entry.reserved_delta))
    return (
      <>
        <span>{amount}</span>
        <span className={styles.note}>{entry.kind === 'hold' ? 'reserved, not spent yet' : 'no longer reserved'}</span>
      </>
    )
  }
  return <span className={entry.credits > 0 ? styles.plus : undefined}>{signed.format(entry.credits)}</span>
}

function Balance({ onBuy }: { onBuy: () => void }) {
  const { data, isPending, isError, refetch } = useWallet()
  return (
    <Card>
      <div className={styles.headRow}>
        <h2 className={styles.heading}>Your credits</h2>
        <Button variant="secondary" onClick={onBuy}>Buy credits</Button>
      </div>
      {isPending && (
        <SkeletonGroup label="Loading balance">
          <Skeleton shape="line" width={120} height={40} />
        </SkeletonGroup>
      )}
      {isError && (
        <p className={styles.note}>
          We could not load your balance. <button type="button" className={styles.linkButton} onClick={() => void refetch()}>Try again</button>
        </p>
      )}
      {data && (
        <>
          <p className={styles.balance}>
            <span className={styles.coin} aria-hidden="true"><CoinIcon size={24} /></span>
            {credits.format(data.available_credits)} <span className={styles.unit}>credits available</span>
          </p>
          {data.reserved_credits > 0 && (
            <p className={styles.note}>Reserved for videos in progress: {credits.format(data.reserved_credits)}</p>
          )}
        </>
      )}
    </Card>
  )
}

function Transactions() {
  const [page, setPage] = useState(1)
  const navigate = useNavigate()
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Pagination scrolls the heading to the top of the screen and focuses it once the new page has arrived.
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: transactionsKey(page, PAGE_SIZE),
    queryFn: () => getTransactions(page, PAGE_SIZE),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  })

  return (
    <Card>
      <h2 ref={headingRef} tabIndex={-1} className={`${styles.heading} ${styles.listHeading}`}>Transactions</h2>
      {isPending && (
        <SkeletonGroup label="Loading transactions">
          <div className={styles.skeletons}>
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} shape="line" height={20} />)}
          </div>
        </SkeletonGroup>
      )}
      {isError && <ErrorState message={`${errMsg(error)} Nothing was charged.`} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && data.total === 0 && (
        <EmptyState
          title="No transactions yet"
          action={<Button onClick={() => void navigate('/create')}>Create a video</Button>}
        >
          Credits you add and spend will show up here.
        </EmptyState>
      )}
      {data && data.items.length > 0 && (
        <>
          {/* Explicit roles: phones restyle these elements with CSS display, which can drop table semantics in Safari. */}
          <table role="table" className={styles.table}>
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Date</th>
                <th role="columnheader" scope="col">What happened</th>
                <th role="columnheader" scope="col" className={styles.right}>Credits</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {data.items.map((e) => (
                <tr role="row" key={e.id}>
                  <td role="cell">{dateFormat.format(new Date(e.created_at))}</td>
                  <td role="cell">{e.job_id ? <Link to={`/create/${e.job_id}`}>{DESCRIPTIONS[e.kind]}</Link> : DESCRIPTIONS[e.kind]}</td>
                  <td role="cell" className={`${styles.right} ${styles.change}`}><Change entry={e} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPageChange={setPage} scrollTargetRef={headingRef} />
        </>
      )}
    </Card>
  )
}

export default function WalletPage() {
  const { config } = useOutletContext<ShellContext>()
  // A new key per opening gives the dialog a fresh start; closing keeps it mounted so focus returns to the button.
  const [buy, setBuy] = useState<{ open: boolean; n: number; returnTo: string | null }>({ open: false, n: 0, returnTo: null })
  // The top bar's "Buy credits" link arrives as /wallet?buy=1: open the dialog, then drop the parameter.
  const [params, setParams] = useSearchParams()
  const wantsBuy = params.get('buy') === '1'
  useEffect(() => {
    if (!wantsBuy) return
    // `return` counts only when it is exactly a job page path; anything else is ignored.
    const returnTo = safeReturnPath(params.get('return'))
    // oxlint-disable-next-line react/set-state-in-effect -- the address is the external trigger; it is consumed once here
    setBuy((b) => ({ open: true, n: b.n + 1, returnTo }))
    setParams((p) => { p.delete('buy'); p.delete('return'); return p }, { replace: true })
  }, [wantsBuy, params, setParams])
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Wallet</h1>
      {buy.returnTo && <p><Link to={buy.returnTo}>Back to your video</Link></p>}
      <Balance onBuy={() => setBuy((b) => ({ open: true, n: b.n + 1, returnTo: b.returnTo }))} />
      <Transactions />
      <BuyCreditsDialog key={buy.n} open={buy.open} onClose={() => setBuy((b) => ({ ...b, open: false }))} config={config} returnTo={buy.returnTo} />
    </div>
  )
}
