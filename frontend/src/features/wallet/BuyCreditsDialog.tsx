import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  ApiError,
  createOrder,
  getOrder,
  getQuote,
  getWallet,
  mockCompletePayment,
  quoteKey,
  verifyPayment,
  walletKey,
} from '../../api/client'
import type { Config, PaymentOrder, Wallet } from '../../api/client'
import { Banner, Dialog } from '../../components/feedback'
import { Button, Spinner, TextField } from '../../components/form'
import { AlertIcon, CheckIcon, CloseIcon } from '../../components/icons'
import { openCheckout } from '../../lib/checkout'
import { formatRupees } from '../../lib/money'
import { errMsg } from '../../lib/util'
import { invalidateWallet, useWallet } from '../../lib/wallet'
import styles from './BuyCreditsDialog.module.css'

const QUICK_PICKS = [1000, 2500, 5000, 10000]
const QUOTE_DEBOUNCE_MS = 300
const POLL_MS = 2000
const POLL_LIMIT = 30 // 30 x 2 s = 60 s, then "still confirming" (UX.md section 7)

const credits = new Intl.NumberFormat('en-IN')

type Proof = { razorpay_payment_id: string; razorpay_signature: string }
type Stage =
  | { kind: 'form' }
  | { kind: 'mock'; order: PaymentOrder }
  // Razorpay's own window is open. Our dialog is closed meanwhile: a modal <dialog> sits in the
  // browser's top layer and makes the rest of the page inert, which would put Checkout's iframe
  // underneath it and make it unusable.
  | { kind: 'checkout'; order: PaymentOrder; failedOnce: boolean }
  | { kind: 'confirming'; order: PaymentOrder; slow: boolean }
  | { kind: 'success'; order: PaymentOrder; credits: number; balance: number }
  // `unknown`: the mock completion call itself failed, so the server may or may not have taken the payment.
  | { kind: 'failed'; unknown?: boolean }
  | { kind: 'cancelled' }

const TITLES: Record<Stage['kind'], string> = {
  form: 'Buy credits',
  mock: 'Mock payment',
  checkout: 'Paying with Razorpay',
  confirming: 'Confirming your payment',
  success: 'Payment received',
  failed: "The payment didn't go through",
  cancelled: 'Payment cancelled',
}

/** A money amount that never breaks across lines; the words around it may wrap. */
function Amount({ children }: { children: ReactNode }) {
  return <span className={styles.amount}>{children}</span>
}

/** "You paid (₹1,000 plus ₹20 payment fee)": the parts are the order's own figures. */
function paidLabel(order: PaymentOrder): ReactNode {
  if (order.fee_paise <= 0) return 'You paid'
  return (
    <>
      You paid (<Amount>{formatRupees(order.price_paise)}</Amount> plus <Amount>{formatRupees(order.fee_paise)}</Amount> payment fee
      {order.fee_gst_paise > 0 && <> and <Amount>{formatRupees(order.fee_gst_paise)}</Amount> GST</>})
    </>
  )
}

export interface BuyCreditsDialogProps {
  open: boolean
  onClose: () => void
  /** From GET /config: payment mode and purchase limits. */
  config: Config | null
  /** A safe `/create/<jobId>` path to go back to after a confirmed payment (D-061). Null or absent: no way back. */
  returnTo?: string | null
}

/**
 * Buy-credits dialog (T-410) and its after-payment states (T-411). The server decides every amount and
 * confirms every payment; this component shows what the server returned and never "credits added" from
 * its own state. Remount it (new `key`) for a fresh start on each open.
 */
export function BuyCreditsDialog({ open, onClose, config, returnTo = null }: BuyCreditsDialogProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const wallet = useWallet()
  const min = config?.min_purchase_credits ?? 1000
  const max = config?.max_purchase_credits ?? 10000

  const [stage, setStageState] = useState<Stage>({ kind: 'form' })
  const stageRef = useRef<Stage>(stage)
  const setStage = useCallback((next: Stage) => {
    stageRef.current = next
    setStageState(next)
  }, [])
  const run = useRef(0) // bumped to ignore results that arrive after a close or a restart
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Until the customer types or picks, the amount is the minimum from config (it may arrive after the dialog mounts).
  const [typed, setTyped] = useState<string | null>(null)
  const amount = typed ?? String(min)
  const [touched, setTouched] = useState(false)
  const [serverError, setServerError] = useState<string | undefined>()
  const [notVerified, setNotVerified] = useState<string | null>(null)
  const [otherError, setOtherError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const payingRef = useRef(false) // state is stale inside two clicks in one task; the ref is not
  const inputRef = useRef<HTMLInputElement>(null)

  const stopPolling = useCallback(() => {
    run.current += 1
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])
  useEffect(() => stopPolling, [stopPolling])

  const parsed = /^-?\d+$/.test(amount.trim()) ? Number(amount.trim()) : null
  const validate = (): string | undefined => {
    if (parsed === null) return 'Enter a whole number of credits.'
    if (parsed < min) return `Buy at least ${credits.format(min)} credits.`
    if (parsed > max) return `You can buy up to ${credits.format(max)} credits at a time.`
    return undefined
  }
  const localError = touched ? validate() : undefined
  const valid = validate() === undefined

  // The quote follows the amount: typing waits briefly, picking a quick amount asks at once.
  const [quoteFor, setQuoteFor] = useState<number | null>(null)
  // Only while open: the page keeps a closed instance mounted, and a quote it fetched would be thrown away on the next open.
  useEffect(() => {
    if (!open || !valid) return
    const t = setTimeout(() => setQuoteFor(parsed), quoteFor === null ? 0 : QUOTE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [open, valid, parsed, quoteFor])
  const quoteQuery = useQuery({
    queryKey: quoteFor === null ? ['payment-quote', 'none'] : quoteKey(quoteFor),
    queryFn: () => getQuote(quoteFor as number),
    enabled: open && quoteFor !== null && valid && quoteFor === parsed,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
  // Only a quote for the amount now in the field counts.
  const quote = valid && quoteQuery.data && quoteQuery.data.credits === parsed ? quoteQuery.data : null
  const quoteError = quoteQuery.error instanceof ApiError ? quoteQuery.error : null
  const quoteFieldError = valid && quoteFor === parsed ? quoteError?.fields.credits : undefined
  // Any failed price request counts, a dropped connection as much as a server answer; both offer "Try again".
  const quoteFailed = valid && quoteFor === parsed && quoteQuery.isError && !quoteQuery.isFetching && !quoteFieldError
  // Once a price request has failed, its message space stays reserved (hidden) so the dialog does not change height
  // when the retry brings the price.
  const [quoteFailedBefore, setQuoteFailedBefore] = useState(false)
  if (quoteFailed && !quoteFailedBefore) setQuoteFailedBefore(true)
  const quoteOtherError = quoteFailed ? (quoteError ? errMsg(quoteError) : 'We could not get the price.') : null
  const error = serverError ?? localError ?? quoteFieldError
  // A price for the amount in the field is on its way (debounce or request in flight).
  const quoting = open && valid && !quote && !quoteFieldError && !quoteFailed
  // The GST row is kept in place while the price loads, so the dialog does not change height when it arrives.
  const showGst = quote ? quote.fee_gst_paise > 0 : (config?.payment_fee_gst_bps ?? 0) > 0

  const changeAmount = (value: string) => {
    setTyped(value)
    setServerError(undefined)
    setNotVerified(null)
    setOtherError(null)
  }

  const finishPaid = useCallback(
    (order: PaymentOrder, creditsAdded: number, serverWallet: Wallet) => {
      stopPolling()
      const balance = serverWallet.available_credits
      queryClient.setQueryData(walletKey, serverWallet) // the job page then opens with the new balance
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
        let res: Awaited<ReturnType<typeof verifyPayment>>
        try {
          res = await verifyPayment(order.order_id, proof.razorpay_payment_id, proof.razorpay_signature)
        } finally {
          // Closed (or unmounted) while the server was confirming: nothing below runs, so ask for a fresh
          // balance and transaction list here. The query client outlives this component.
          if (run.current !== id) void invalidateWallet(queryClient)
        }
        if (run.current !== id) return
        if (res.status === 'paid') finishPaid(order, res.credits, res.wallet)
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
    [finishPaid, poll, queryClient, setStage, stopPolling],
  )

  const pay = async (event?: FormEvent) => {
    event?.preventDefault()
    if (busy || payingRef.current) return
    setTouched(true)
    if (!valid || parsed === null) {
      inputRef.current?.focus()
      return
    }
    payingRef.current = true
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
        const inCheckout = () => run.current === id && stageRef.current.kind === 'checkout'
        setStage({ kind: 'checkout', order, failedOnce: false })
        try {
          await openCheckout({
            order,
            onSuccess: (r) => {
              if (run.current === id) void verify(order, r)
            },
            onFailed: () => {
              // Razorpay keeps its window open so the customer can retry there; remember the
              // failure and show it only when the window closes without a success.
              if (inCheckout()) setStage({ kind: 'checkout', order, failedOnce: true })
            },
            onDismiss: () => {
              // Closing the window after paying is not a cancel (verify has moved the stage on).
              const now = stageRef.current
              if (inCheckout() && now.kind === 'checkout') {
                setStage({ kind: now.failedOnce ? 'failed' : 'cancelled' })
              }
            },
          })
        } catch (e) {
          if (run.current === id) setStage({ kind: 'form' })
          throw e
        }
      }
    } catch (e) {
      if (run.current !== id) return
      if (e instanceof ApiError && e.status === 403 && e.code === 'email_not_verified') setNotVerified(e.message)
      else if (e instanceof ApiError && e.fields.credits) {
        setServerError(e.fields.credits)
        inputRef.current?.focus()
      } else setOtherError(`${errMsg(e)} You were not charged.`)
    } finally {
      payingRef.current = false
      setBusy(false)
    }
  }

  const mockComplete = async (order: PaymentOrder, outcome: 'captured' | 'failed') => {
    if (busy || payingRef.current) return
    payingRef.current = true
    setBusy(true)
    const id = run.current
    try {
      const proof = await mockCompletePayment(order.order_id, outcome)
      if (run.current !== id) return
      if (outcome === 'failed') setStage({ kind: 'failed' })
      else await verify(order, proof)
    } catch {
      if (run.current !== id) return
      // The completion call failed, so whether the payment was taken is unknown: never say "no credits were added".
      if (outcome === 'captured') {
        void invalidateWallet(queryClient)
        setStage({ kind: 'failed', unknown: true })
      } else setStage({ kind: 'failed' })
    } finally {
      payingRef.current = false
      setBusy(false)
    }
  }

  const close = () => {
    stopPolling()
    if (stageRef.current.kind === 'confirming') void invalidateWallet(queryClient)
    onClose()
  }
  const backToVideo = () => {
    stopPolling()
    void invalidateWallet(queryClient)
    onClose()
    if (returnTo) void navigate(returnTo)
  }
  const tryAgain = () => {
    stopPolling()
    setStage({ kind: 'form' })
  }

  const youGet = valid && parsed !== null ? parsed : null
  const balanceAfter = youGet !== null && wallet.data ? wallet.data.available_credits + youGet : null
  const mockMode = config?.payments === 'mock'
  const title = stage.kind === 'failed' && stage.unknown ? 'Payment not confirmed yet' : TITLES[stage.kind]
  const backLink = returnTo ? (
    <Link to={returnTo} onClick={close}>Back to your video</Link>
  ) : null

  return (
    <Dialog open={open && stage.kind !== 'checkout'} onClose={close} title={title} dismissable={stage.kind === 'form'} wideWhenShort={stage.kind === 'form'}>
      {stage.kind === 'form' && (
        <form className={styles.stack} onSubmit={(e) => void pay(e)} noValidate>
          <div className={styles.choose}>
            <p className={styles.lead}>₹1 = 1 credit. Credits do not expire.</p>
            <div role="group" aria-label="Quick amounts in credits" className={styles.picks}>
              {QUICK_PICKS.filter((n) => n >= min && n <= max).map((n) => (
                <Button
                  key={n}
                  variant="secondary"
                  aria-pressed={parsed === n}
                  className={styles.pick}
                  onClick={() => {
                    changeAmount(String(n))
                    if (quoteFailed && n === parsed) void quoteQuery.refetch() // same amount again: ask again
                    setQuoteFor(n)
                    setTouched(false)
                  }}
                >
                  {credits.format(n)} credits
                </Button>
              ))}
            </div>
            <div className={styles.amountField}>
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
            </div>
          </div>
          <dl className={styles.summary} aria-busy={quoting || undefined}>
            <div className={styles.row}>
              <dt className={styles.strong}>You get</dt>
              <dd className={styles.strong}>{youGet !== null ? `${credits.format(youGet)} credits` : '—'}</dd>
            </div>
            <div className={styles.row}>
              <dt>Price</dt>
              <dd>{quote ? formatRupees(quote.price_paise) : '—'}</dd>
            </div>
            <div className={styles.row}>
              <dt>Payment fee</dt>
              <dd>{quote ? formatRupees(quote.fee_paise) : '—'}</dd>
            </div>
            {showGst && (
              <div className={styles.row}>
                <dt>GST on the fee</dt>
                <dd>{quote ? formatRupees(quote.fee_gst_paise) : '—'}</dd>
              </div>
            )}
            <div className={styles.row}>
              <dt className={styles.strong}>You pay</dt>
              <dd className={styles.strong}>{quote ? formatRupees(quote.amount_paise) : '—'}</dd>
            </div>
            <div className={styles.row}>
              <dt>Balance after</dt>
              <dd>{balanceAfter !== null ? `${credits.format(balanceAfter)} credits` : '—'}</dd>
            </div>
          </dl>
          <p className={styles.fine}>The payment fee covers the card or UPI charge.</p>
          {returnTo && <p className={styles.fine}>After paying you'll come back to this video.</p>}
          {(quoteFailedBefore || notVerified || otherError) && (
            <div className={styles.messages}>
              {quoteFailedBefore && (
                <div className={quoteFailed ? styles.quoteFail : `${styles.quoteFail} ${styles.reserved}`} aria-hidden={quoteFailed ? undefined : true}>
                  <p role={quoteFailed ? 'alert' : undefined} className={styles.problem}>{quoteOtherError ?? 'We could not get the price.'} Nothing was charged.</p>
                  <Button type="button" variant="secondary" onClick={() => void quoteQuery.refetch()}>Try again</Button>
                </div>
              )}
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
            </div>
          )}
          <Button
            type="submit"
            size="large"
            block
            className={styles.pay}
            busy={busy || quoting}
            busyLabel={busy ? 'Starting payment…' : 'Getting the price…'}
            disabled={!config || !quote}
          >
            {quote ? `Pay ${formatRupees(quote.amount_paise)}` : 'Pay'}
          </Button>
          <p className={styles.fine}>Payment is handled by Razorpay. We never see your card details.</p>
        </form>
      )}

      {stage.kind === 'mock' && (
        <div className={styles.result}>
          <p className={styles.text}>
            Mock mode: no real payment is made. Choose how this <Amount>{formatRupees(stage.order.amount_paise)}</Amount> payment should end.
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
          {backLink}
        </div>
      )}

      {stage.kind === 'success' && (
        <div className={styles.result}>
          <span className={`${styles.badge} ${styles.ok}`} aria-hidden="true"><CheckIcon size={26} /></span>
          <p className={styles.text}>
            <Amount>{credits.format(stage.credits)} credits</Amount> were added to your wallet.
            {returnTo && <> Your balance is now <Amount>{credits.format(stage.balance)} credits</Amount>. You can approve your video.</>}
          </p>
          <dl className={styles.summary}>
            <div className={`${styles.row} ${styles.longRow}`}>
              <dt>{paidLabel(stage.order)}</dt>
              <dd>{formatRupees(stage.order.amount_paise)}</dd>
            </div>
            <div className={styles.row}>
              <dt className={styles.strong}>Balance now</dt>
              <dd className={styles.strong}>{credits.format(stage.balance)} credits</dd>
            </div>
          </dl>
          <Button block size="large" onClick={returnTo ? backToVideo : close}>{returnTo ? 'Back to your video' : 'Done'}</Button>
        </div>
      )}

      {stage.kind === 'failed' && (
        <div className={styles.result}>
          <span className={`${styles.badge} ${styles.bad}`} aria-hidden="true"><AlertIcon size={24} /></span>
          <p role="alert" className={styles.text}>
            {stage.unknown
              ? 'We could not confirm this payment yet. If it went through, your balance will update, but this can take a few minutes. Check your balance before trying again.'
              : mockMode
                ? 'No credits were added. Try again.'
                : 'No credits were added. Try again, or choose another way to pay in the Razorpay window.'}
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={close}>Close</Button>
            <Button onClick={tryAgain}>Try again</Button>
          </div>
          {backLink}
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
          {backLink}
        </div>
      )}
    </Dialog>
  )
}
