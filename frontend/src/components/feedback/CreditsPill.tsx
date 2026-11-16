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

export function CreditsPill({ balance, loading = false, low = false, href }: CreditsPillProps) {
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
        <span className={styles.amount}>{new Intl.NumberFormat('en-IN').format(balance ?? 0)} credits</span>
      )}
    </>
  )
  return href ? <a href={href} className={className}>{content}</a> : <span className={className}>{content}</span>
}
