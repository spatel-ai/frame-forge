import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import {
  ApiError,
  createOrder,
  getOrder,
  getWallet,
  mockCompletePayment,
  verifyPayment,
  walletKey,
} from '../../api/client'
import type { Config, PaymentOrder } from '../../api/client'
import { Banner, Dialog } from '../../components/feedback'
import { Button, Spinner, TextField } from '../../components/form'
import { AlertIcon, CheckIcon, CloseIcon } from '../../components/icons'
import { openCheckout } from '../../lib/checkout'
import { errMsg } from '../../lib/util'
import { invalidateWallet } from './invalidate'
import { useWallet } from './useWallet'
import styles from './BuyCreditsDialog.module.css'

const QUICK_PICKS = [500, 1000, 2500, 5000]
const POLL_MS = 2000
const POLL_LIMIT = 30 // 30 x 2 s = 60 s, then "still confirming" (UX.md section 7)

const credits = new Intl.NumberFormat('en-IN')
const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

type Proof = { razorpay_payment_id: string; razorpay_signature: string }
type Stage =
  | { kind: 'form' }
  | { kind: 'mock'; order: PaymentOrder }
  | { kind: 'confirming'; order: PaymentOrder; slow: boolean }
  | { kind: 'success'; order: PaymentOrder; credits: number; balance: number }
  | { kind: 'failed' }
  | { kind: 'cancelled' }

const TITLES: Record<Stage['kind'], string> = {
  form: 'Buy credits',
  mock: 'Mock payment',
  confirming: 'Confirming your payment',
  success: 'Payment received',
  failed: "The payment didn't go through",
  cancelled: 'Payment cancelled',
}

export interface BuyCreditsDialogProps {
  open: boolean
  onClose: () => void
  /** From GET /config: payment mode and purchase limits. */
  config: Config | null
}

/**
 * Buy-credits dialog (T-410) and its after-payment states (T-411). The server decides every amount and
 * confirms every payment; this component shows what the server returned and never "credits added" from
 * its own state. Remount it (new `key`) for a fresh start on each open.
 */
export function BuyCreditsDialog({ open, onClose, config }: BuyCreditsDialogProps) {
  const queryClient = useQueryClient()
  const wallet = useWallet()
  const min = config?.min_purchase_credits ?? 500
  const max = config?.max_purchase_credits ?? 10000

  const [stage, setStageState] = useState<Stage>({ kind: 'form' })
  const stageRef = useRef<Stage>(stage)
  const setStage = useCallback((next: Stage) => {
    stageRef.current = next
    setStageState(next)
  }, [])
  const run = useRef(0) // bumped to ignore results that arrive after a close or a restart
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [amount, setAmount] = useState('500')
  const [touched, setTouched] = useState(false)
  const [serverError, setServerError] = useState<string | undefined>()
  const [notVerified, setNotVerified] = useState<string | null>(null)
  const [otherError, setOtherError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const stopPolling = useCallback(() => {
    run.current += 1
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])
  useEffect(() => stopPolling, [stopPolling])

  const parsed = /^\d+$/.test(amount.trim()) ? Number(amount.trim()) : null
  const validate = (): string | undefined => {
    if (parsed === null) return 'Enter a whole number of credits.'
    if (parsed < min) return `Buy at least ${credits.format(min)} credits.`
    if (parsed > max) return `You can buy up to ${credits.format(max)} credits at a time.`
    return undefined
  }
  const localError = touched ? validate() : undefined
  const error = serverError ?? localError
  const valid = validate() === undefined

  const changeAmount = (value: string) => {
    setAmount(value)
    setServerError(undefined)
    setNotVerified(null)
    setOtherError(null)
  }

  const finishPaid = useCallback(
    (order: PaymentOrder, creditsAdded: number, balance: number) => {
      stopPolling()
      void invalidateWallet(queryClient) // the credits pill and the page refetch from the server
      setStage({ kind: 'success', order, credits: creditsAdded, balance })
    },
    [queryClient, setStage, stopPolling],
  )

  const poll = useCallback(
    (order: PaymentOrder) => {
      const id = ++run.current
      let attempts = 0
      const tick = async () => {
        if (run.current !== id) return
        attempts += 1
        try {
          const status = await getOrder(order.order_id)
          if (run.current !== id) return
          if (status.status === 'paid') {
            // Credits shown only from a fresh wallet read.
            const fresh = await queryClient.fetchQuery({ queryKey: walletKey, queryFn: getWallet, staleTime: 0 })
            if (run.current !== id) return
            void invalidateWallet(queryClient)
            setStage({ kind: 'success', order, credits: status.credits, balance: fresh.available_credits })
            return
          }
          if (status.status === 'failed') {
            setStage({ kind: 'failed' })
            return
          }
        } catch {
          /* keep checking until the minute is up */
        }
        if (run.current !== id) return
        if (attempts >= POLL_LIMIT) {
          setStage({ kind: 'confirming', order, slow: true })
          void invalidateWallet(queryClient)
          return
        }
        timer.current = setTimeout(() => void tick(), POLL_MS)
      }
      timer.current = setTimeout(() => void tick(), POLL_MS)
    },
    [queryClient, setStage],
  )

  /** A browser success is not a payment: ask the server. */
  const verify = useCallback(
    async (order: PaymentOrder, proof: Proof) => {
      stopPolling()
      const id = run.current
      setStage({ kind: 'confirming', order, slow: false })
      try {
        const res = await verifyPayment(order.order_id, proof.razorpay_payment_id, proof.razorpay_signature)
        if (run.current !== id) return
        if (res.status === 'paid') finishPaid(order, res.credits, res.wallet.available_credits)
        else if (res.status === 'failed') setStage({ kind: 'failed' })
        else poll(order)
      } catch (e) {
        if (run.current !== id) return
        if (e instanceof ApiError && e.status === 409 && e.code === 'payment_not_captured') poll(order)
        else if (e instanceof ApiError && e.status >= 400 && e.status < 500) setStage({ kind: 'failed' })
        // Network or server trouble: the money may have moved, so ask the order instead of saying "failed".
        else poll(order)
      }
    },
    [finishPaid, poll, setStage, stopPolling],
  )

  const pay = async (event?: FormEvent) => {
    event?.preventDefault()
    if (busy) return
    setTouched(true)
    if (!valid || parsed === null) {
      inputRef.current?.focus()
      return
    }
    setBusy(true)
    setServerError(undefined)
    setNotVerified(null)
    setOtherError(null)
    stopPolling()
    const id = run.current
    try {
      const order = await createOrder(parsed)
      if (run.current !== id) return
      if (config?.payments === 'mock') {
        setStage({ kind: 'mock', order })
      } else {
        await openCheckout({
          order,
          onSuccess: (r) => {
            if (run.current === id) void verify(order, r)
          },
          onFailed: () => {
            if (run.current === id && stageRef.current.kind === 'form') setStage({ kind: 'failed' })
          },
          onDismiss: () => {
            // Closing the window after paying or failing is not a cancel.
            if (run.current === id && stageRef.current.kind === 'form') setStage({ kind: 'cancelled' })
          },
        })
      }
    } catch (e) {
      if (run.current !== id) return
      if (e instanceof ApiError && e.status === 403 && e.code === 'email_not_verified') setNotVerified(e.message)
      else if (e instanceof ApiError && e.fields.credits) {
        setServerError(e.fields.credits)
        inputRef.current?.focus()
      } else setOtherError(`${errMsg(e)} You were not charged.`)
    } finally {
      setBusy(false)
    }
  }

  const mockComplete = async (order: PaymentOrder, outcome: 'captured' | 'failed') => {
    if (busy) return
    setBusy(true)
    const id = run.current
    try {
      const proof = await mockCompletePayment(order.order_id, outcome)
      if (run.current !== id) return
      if (outcome === 'failed') setStage({ kind: 'failed' })
      else await verify(order, proof)
    } catch {
      if (run.current === id) setStage({ kind: 'failed' })
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    stopPolling()
    if (stageRef.current.kind === 'confirming') void invalidateWallet(queryClient)
    onClose()
  }
  const tryAgain = () => {
    stopPolling()
    setStage({ kind: 'form' })
  }

  const youGet = valid && parsed !== null ? parsed : null
  const balanceAfter = youGet !== null && wallet.data ? wallet.data.available_credits + youGet : null

  return (
    <Dialog open={open} onClose={close} title={TITLES[stage.kind]} dismissable={stage.kind === 'form'}>
      {stage.kind === 'form' && (
        <form className={styles.stack} onSubmit={(e) => void pay(e)} noValidate>
          <p className={styles.lead}>₹1 = 1 credit. Credits do not expire.</p>
          <div role="group" aria-label="Quick amounts in credits" className={styles.picks}>
            {QUICK_PICKS.map((n) => (
              <Button
                key={n}
                variant="secondary"
                aria-pressed={parsed === n}
                className={styles.pick}
                onClick={() => {
                  changeAmount(String(n))
                  setTouched(false)
                }}
              >
                {credits.format(n)} credits
              </Button>
            ))}
          </div>
          <TextField
            ref={inputRef}
            label="Credits to buy"
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            value={amount}
            hint={`Whole credits, from ${credits.format(min)} to ${credits.format(max)} credits.`}
            error={error}
            onChange={(e) => changeAmount(e.target.value)}
            onBlur={() => setTouched(true)}
          />
          <dl className={styles.summary}>
            <div className={styles.row}>
              <dt className={styles.strong}>You get</dt>
              <dd className={styles.strong}>{youGet !== null ? `${credits.format(youGet)} credits` : '—'}</dd>
            </div>
            <div className={styles.row}>
              <dt>You pay</dt>
              <dd>{youGet !== null ? rupees.format(youGet) : '—'}</dd>
            </div>
            <div className={styles.row}>
              <dt>Balance after</dt>
              <dd>{balanceAfter !== null ? `${credits.format(balanceAfter)} credits` : '—'}</dd>
            </div>
          </dl>
          {notVerified && (
            <Banner
              tone="warning"
              title="Confirm your email first"
              action={<Link to="/account" onClick={close}>Go to your account to confirm your email</Link>}
            >
              {notVerified} Nothing was charged.
            </Banner>
          )}
          {otherError && <p role="alert" className={styles.problem}>{otherError}</p>}
          <Button type="submit" size="large" block busy={busy} busyLabel="Starting payment…" disabled={!config}>
            {youGet !== null ? `Pay ${rupees.format(youGet)}` : 'Pay'}
          </Button>
          <p className={styles.fine}>Payment is handled by Razorpay. We never see your card details.</p>
        </form>
      )}

      {stage.kind === 'mock' && (
        <div className={styles.result}>
          <p className={styles.text}>
            Mock mode: no real payment is made. Choose how this {rupees.format(stage.order.amount_paise / 100)} payment should end.
          </p>
          <div className={styles.actions}>
            <Button busy={busy} onClick={() => void mockComplete(stage.order, 'captured')}>Pay</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void mockComplete(stage.order, 'failed')}>Fail</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setStage({ kind: 'cancelled' })}>Cancel</Button>
          </div>
        </div>
      )}

      {stage.kind === 'confirming' && (
        <div className={styles.result} aria-busy={!stage.slow}>
          {!stage.slow && <Spinner size="large" label="Confirming payment" />}
          <p role="status" className={styles.text}>
            {stage.slow
              ? 'This is taking longer than usual. If money left your account, the credits will appear in your wallet within 30 minutes. You can close this window.'
              : 'This usually takes a few seconds. Please keep this window open.'}
          </p>
          <Button variant="secondary" block onClick={close}>Close</Button>
        </div>
      )}

      {stage.kind === 'success' && (
        <div className={styles.result}>
          <span className={`${styles.badge} ${styles.ok}`} aria-hidden="true"><CheckIcon size={26} /></span>
          <p className={styles.text}>{credits.format(stage.credits)} credits were added to your wallet.</p>
          <dl className={styles.summary}>
            <div className={styles.row}>
              <dt>You paid</dt>
              <dd>{rupees.format(stage.order.amount_paise / 100)}</dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.strong}>Balance now</dt>
              <dd className={styles.strong}>{credits.format(stage.balance)} credits</dd>
            </div>
          </dl>
          <Button block size="large" onClick={close}>Done</Button>
        </div>
      )}

      {stage.kind === 'failed' && (
        <div className={styles.result}>
          <span className={`${styles.badge} ${styles.bad}`} aria-hidden="true"><AlertIcon size={24} /></span>
          <p role="alert" className={styles.text}>
            No credits were added. Try again, or choose another way to pay in the Razorpay window.
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={close}>Close</Button>
            <Button onClick={tryAgain}>Try again</Button>
          </div>
        </div>
      )}

      {stage.kind === 'cancelled' && (
        <div className={styles.result}>
          <span className={`${styles.badge} ${styles.neutral}`} aria-hidden="true"><CloseIcon size={22} /></span>
          <p className={styles.text}>
            You closed the payment window, so no credits were added. If you did finish paying, the credits will appear
            in your wallet within 30 minutes.
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={close}>Close</Button>
            <Button onClick={tryAgain}>Try again</Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
