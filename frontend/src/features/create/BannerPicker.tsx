import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { Banner as Notice, ErrorState, Skeleton, SkeletonGroup } from '../../components/feedback'
import { SelectableCard, SelectableCardGroup } from '../../components/form'
import type { useBanners } from '../../lib/banners'
import { errMsg } from '../../lib/util'
import styles from './BannerPicker.module.css'
import screens from './screens.module.css'

/** Phone: more banners than this get a list of its own height (about 4.5 cards) that scrolls itself. */
const PHONE_UNCAPPED = 5
/** Tablet and desktop: more rows than this get a grid of about 3.5 rows that scrolls itself. */
const WIDE_UNCAPPED_ROWS = 3
const WIDE = '(min-width: 768px)'

/**
 * Measures the cards and, when there are many, caps the card list at a whole number of cards plus
 * half of the next one, so it is plain that the list scrolls. Returns the wrapper's ref.
 */
function useCappedCards(count: number, selected: string | null) {
  const ref = useRef<HTMLDivElement>(null)
  const [cap, setCap] = useState<number | null>(null)
  const [scrollbar, setScrollbar] = useState(0)
  const [moreBelow, setMoreBelow] = useState(false)

  useLayoutEffect(() => {
    const wrapper = ref.current
    const list = wrapper?.querySelector<HTMLElement>('fieldset > div')
    if (!wrapper || !list) return
    const measure = () => {
      const cards = Array.from(list.querySelectorAll<HTMLElement>(':scope > label'))
      const listTop = list.getBoundingClientRect().top - list.scrollTop
      // One entry per row: the top and the height of its first card.
      const rows: { top: number; height: number }[] = []
      for (const card of cards) {
        const r = card.getBoundingClientRect()
        const top = r.top - listTop
        if (!rows.length || top > rows[rows.length - 1].top + 1) rows.push({ top, height: r.height })
      }
      const wide = typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches
      const keep = wide ? WIDE_UNCAPPED_ROWS : PHONE_UNCAPPED - 1
      const many = wide ? rows.length > WIDE_UNCAPPED_ROWS : cards.length > PHONE_UNCAPPED
      setCap(many && rows[keep] ? Math.round(rows[keep].top + rows[keep].height / 2) : null)
      setScrollbar(list.offsetWidth - list.clientWidth)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    // The cards too: once the list is capped, a card growing (an image arriving) no longer changes
    // the wrapper's size.
    const observer = new ResizeObserver(measure)
    observer.observe(wrapper)
    list.querySelectorAll(':scope > label').forEach((card) => observer.observe(card))
    return () => observer.disconnect()
  }, [count])

  // The fade over the bottom edge shows while more cards are below.
  useEffect(() => {
    const list = ref.current?.querySelector<HTMLElement>('fieldset > div')
    if (!list || cap === null) {
      setMoreBelow(false)
      return
    }
    const update = () => setMoreBelow(list.scrollTop + list.clientHeight < list.scrollHeight - 1)
    update()
    list.addEventListener('scroll', update, { passive: true })
    return () => list.removeEventListener('scroll', update)
  }, [cap])

  // Keep the chosen banner in view. Chosen with the keyboard (focus is on its radio): the whole card,
  // in the list and on the page, as the browser only scrolls the hidden 1 px radio into view.
  // Otherwise, as when the step opens with one chosen: inside the capped list only, never moving the page.
  useEffect(() => {
    const list = ref.current?.querySelector<HTMLElement>('fieldset > div')
    if (!list || !selected) return
    const input = list.querySelector<HTMLInputElement>('input:checked')
    const card = input?.closest('label')
    if (!input || !card) return
    if (document.activeElement === input) {
      card.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
      return
    }
    if (cap === null) return
    const top = card.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop
    const bottom = top + card.offsetHeight
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - (list.clientHeight - card.offsetHeight) / 2)
    }
  }, [cap, selected])

  return { ref, cap, scrollbar, moreBelow }
}

/** "Choose a banner" (D-067): the customer's banners as radio cards. The choice is held by the parent. */
export function BannerPicker({
  banners,
  selected,
  onSelect,
  error,
  disabled,
}: {
  banners: ReturnType<typeof useBanners>
  selected: string | null
  onSelect: (id: string) => void
  error: string | null
  disabled: boolean
}) {
  const { data, isPending, isError } = banners
  const { ref: cardsRef, cap, scrollbar, moreBelow } = useCappedCards(data?.length ?? 0, selected)
  let body
  if (isPending) {
    body = (
      <SkeletonGroup label="Loading your banners">
        <Skeleton height={96} />
      </SkeletonGroup>
    )
  } else if (isError && !data) {
    body = <ErrorState title="We could not load your banners" message={errMsg(banners.error)} onRetry={() => void banners.refetch()} />
  } else if (data && data.length === 0) {
    body = (
      <Notice
        tone="warning"
        title="No banners yet"
        action={<Link className={screens.textLink} to="/banners">Upload a banner</Link>}
      >
        You have no banners yet. Upload one to make this video.
      </Notice>
    )
  } else if (data) {
    body = (
      <>
        <div
          ref={cardsRef}
          className={`${styles.grid} ${cap !== null ? styles.capped : ''}`}
          style={cap !== null ? ({ '--cards-cap': `${cap}px`, '--scrollbar': `${scrollbar}px` } as CSSProperties) : undefined}
          data-more-below={moreBelow || undefined}
        >
        <SelectableCardGroup legend="Banner for this video" required error={error ?? undefined} name="banner">
          {data.map((b) => (
            <SelectableCard
              key={b.id}
              value={b.id}
              label={b.name}
              checked={selected === b.id}
              disabled={disabled}
              onChange={() => onSelect(b.id)}
              media={<img className={styles.preview} src={b.image_url} alt="" />}
            />
          ))}
        </SelectableCardGroup>
        </div>
        <Link className={`${screens.textLink} ${styles.manage}`} to="/banners">Manage banners</Link>
      </>
    )
  }
  return (
    <section className={screens.cardBody} aria-labelledby="h-banner">
      <h2 id="h-banner" className={screens.heading}>Choose a banner</h2>
      <p className={screens.note}>It opens and closes your video and shows in the corner while the person speaks.</p>
      {error && !(data && data.length > 0) && <Notice tone="danger" title="Choose a banner">{error}</Notice>}
      {body}
    </section>
  )
}
