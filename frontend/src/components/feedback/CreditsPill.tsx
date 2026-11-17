import { CoinIcon } from '../icons'
import styles from './CreditsPill.module.css'
import { Skeleton } from './Skeleton'

export interface CreditsPillProps {
  /** Whole-number balance as returned by the server. */
  balance?: number
  loading?: boolean
  /** Warning tone for a low balance. */
  low?: boolean
  /** When set the pill is a link (the top bar links to Wallet). */
  href?: string
}

const FULL = new Intl.NumberFormat('en-IN')
// Display only: a shortened form ("9.9L", "1Cr") for very narrow screens. Rounds down so it never overstates.
const COMPACT = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1, roundingMode: 'floor' } as Intl.NumberFormatOptions)

export function CreditsPill({ balance, loading = false, low = false, href }: CreditsPillProps) {
  const exact = FULL.format(balance ?? 0)
  const compact = COMPACT.format(balance ?? 0)
  // Display classes only (how much room the figure needs); the value itself is never changed.
  const size = exact.length >= 11 ? styles.huge : exact.length >= 9 ? styles.long : ''
  const className = `${styles.pill} ${low ? styles.low : ''}`
  const content = (
    <>
      <span className={styles.coin}><CoinIcon size={18} /></span>
      {loading ? (
        <span role="status" aria-busy="true">
          <span className={styles.srOnly}>Loading credits</span>
          <Skeleton shape="line" width={48} />
        </span>
      ) : (
        <span className={`${styles.amount} ${size}`} title={`${exact} credits`}>
          {/* The visible figure is drawn from data-v so the text exists once in the document (for screen readers). */}
          <span className={styles.srOnly}>{exact} credits</span>
          <span aria-hidden="true" className={styles.full} data-v={exact} />
          <span aria-hidden="true" className={styles.short} data-v={compact} />
          <span aria-hidden="true" className={styles.word} data-v=" credits" />
        </span>
      )}
    </>
  )
  return href ? <a href={href} className={className}>{content}</a> : <span className={className}>{content}</span>
}
