import { PlayIcon } from '../icons'
import styles from './Logo.module.css'

/**
 * The Frameforge mark with the wordmark beside it. With `wordmark={false}` the name stays for
 * screen readers only. `collapseOnTablet` hides the visible word from 768 to 1023 px (icon-only sidebar).
 */
export function Logo({ wordmark = true, collapseOnTablet = false }: { wordmark?: boolean; collapseOnTablet?: boolean }) {
  const wordClass = !wordmark ? styles.srOnly : collapseOnTablet ? `${styles.word} ${styles.collapse}` : styles.word
  return (
    <span className={styles.logo}>
      <span className={styles.mark}><PlayIcon size={18} fill="currentColor" /></span>
      <span className={wordClass}>Frameforge</span>
    </span>
  )
}
