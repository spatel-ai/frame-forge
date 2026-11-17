import { Link } from 'react-router'
import { Banner as Notice, ErrorState, Skeleton, SkeletonGroup } from '../../components/feedback'
import { SelectableCard, SelectableCardGroup } from '../../components/form'
import type { useBanners } from '../../lib/banners'
import { errMsg } from '../../lib/util'
import styles from './BannerPicker.module.css'
import screens from './screens.module.css'

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
      <Notice tone="warning" title="No banners yet">
        You have no banners yet. Upload one to make this video.{' '}
        <Link className={screens.sentenceLink} to="/banners">Upload a banner</Link>
      </Notice>
    )
  } else if (data) {
    body = (
      <>
        <div className={styles.grid}>
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
