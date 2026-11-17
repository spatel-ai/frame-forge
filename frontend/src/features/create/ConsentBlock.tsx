import { forwardRef } from 'react'
import type { Config } from '../../api/client'
import { Checkbox } from '../../components/form'
import { Card } from '../../components/layout'
import { formatCredits } from './credits'
import styles from './ConsentBlock.module.css'

/**
 * Permission to use the photo (R-14, D-045). The wording and its version come from the server config;
 * the box is never pre-ticked. Reusable by every step that makes a voice.
 */
export const ConsentBlock = forwardRef<
  HTMLInputElement,
  { config: Config; checked: boolean; onChange: (checked: boolean) => void; error?: string }
>(function ConsentBlock({ config, checked, onChange, error }, ref) {
  return (
    <section className={styles.block} aria-labelledby="h-consent">
      <h2 id="h-consent" className={styles.heading}>Permission to use this photo</h2>
      <Checkbox
        ref={ref}
        label={config.consent_text}
        hint="Required. We keep a record of this agreement with your video."
        checked={checked}
        error={error}
        onChange={(e) => onChange(e.target.checked)}
      />
    </section>
  )
})

/** What the voice costs and when it is taken. Amounts come from the server; nothing is calculated here. */
export function VoiceCostBox({ config, balance }: { config: Config; balance: number | undefined }) {
  const price = formatCredits(config.voice_price_credits)
  return (
    <Card padding="lg">
      <div className={styles.block}>
        <dl className={styles.cost}>
          <div className={styles.row}>
            <dt>Voice ({price} credits)</dt>
            <dd className={styles.taken}>Taken now</dd>
          </div>
          {balance !== undefined && (
            <div className={styles.row}>
              <dt>Your balance</dt>
              <dd>{formatCredits(balance)} credits</dd>
            </div>
          )}
        </dl>
        <p className={styles.note}>
          If we cannot make the voice, the {price} credits are returned. If you decide not to make the video after
          listening, they are kept. The video price is shown after you listen, and nothing more is taken until you approve it.
        </p>
      </div>
    </Card>
  )
}
