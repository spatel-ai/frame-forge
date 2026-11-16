import type { ReactNode } from 'react'
import { CheckIcon, PlayIcon } from '../../components/icons'
import { BrandBackdrop, BrandIllustration, CardBackdrop } from './AuthIllustration'
import styles from './AuthLayout.module.css'

const TICKS = [
  'English, Hindi and Punjabi voices',
  'Listen to the voice free before you pay',
  'Videos up to 30 seconds, ready to download',
]

/** The split screen shared by every auth screen: brand panel left, card on a decorated background right. No app shell. */
export function AuthLayout({ children, credit = true }: { children: ReactNode; credit?: boolean }) {
  return (
    <div className={styles.page}>
      <aside className={styles.brand} aria-label="About Frameforge">
        <div className={styles.backdrop}><BrandBackdrop /></div>
        <div className={styles.logo}>
          <span className={styles.mark}><PlayIcon size={20} fill="currentColor" aria-hidden="true" /></span>
          <span className={styles.word}>Frameforge</span>
        </div>
        <div className={styles.art}><BrandIllustration credit={credit} /></div>
        <div className={styles.pitch}>
          <p className={styles.headline}>Your photo. Your script. A talking video.</p>
          <ul className={styles.ticks}>
            {TICKS.map((t) => (
              <li key={t}>
                <CheckIcon size={20} aria-hidden="true" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <div className={styles.side}>
        <div className={styles.backdrop}><CardBackdrop /></div>
        <main className={styles.card}>{children}</main>
        <p className={styles.note}>Videos made here are AI-generated.</p>
      </div>
    </div>
  )
}
