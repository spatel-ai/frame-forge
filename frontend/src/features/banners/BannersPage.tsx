import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { ApiError, bannersKey, createBanner, deleteBanner } from '../../api/client'
import type { Banner } from '../../api/client'
import { Banner as Notice, Dialog, EmptyState, ErrorState, Skeleton, SkeletonGroup } from '../../components/feedback'
import { Button, FileDropZone, TextField } from '../../components/form'
import { UploadIcon } from '../../components/icons'
import {
  BANNER_ACCEPT, BANNER_ACCEPT_LABEL, BANNER_MAX_BYTES, BANNER_NAME_MAX, bannerDate, bannerNameError, useBanners,
} from '../../lib/banners'
import { errMsg } from '../../lib/util'
import styles from './banners.module.css'

const INTRO =
  'Upload your logo or banner image. You choose one for each video: it opens and closes the video and shows in the corner while the person speaks.'

type Errors = { name?: string; image?: string; other?: string }

function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const nameRef = useRef<HTMLInputElement>(null)
  const save = useMutation({
    mutationFn: ({ n, f }: { n: string; f: File }) => createBanner(n, f),
    onSuccess: () => {
      setName('')
      setFile(null)
      setErrors({})
      onClose()
      return queryClient.invalidateQueries({ queryKey: bannersKey })
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.fields.name || err.fields.image)) {
        setErrors({ name: err.fields.name, image: err.fields.image })
      } else setErrors({ other: `${errMsg(err)} Nothing was saved. What you entered is still here; try again.` })
    },
  })
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const next: Errors = { name: bannerNameError(name), image: file ? undefined : 'Choose an image for the banner.' }
    if (next.name || next.image) {
      setErrors(next)
      if (next.name) nameRef.current?.focus()
      return
    }
    setErrors({})
    if (file) save.mutate({ n: name.trim(), f: file })
  }
  return (
    <Dialog open={open} onClose={() => { if (!save.isPending) onClose() }} title="Upload banner">
      <form className={styles.form} onSubmit={submit} noValidate>
        <TextField
          ref={nameRef}
          label="Banner name"
          hint={`Up to ${BANNER_NAME_MAX} characters. Only you see it.`}
          required
          maxLength={BANNER_NAME_MAX}
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            if (errors.name) setErrors((p) => ({ ...p, name: bannerNameError(e.target.value) }))
          }}
          onBlur={() => { if (name) setErrors((p) => ({ ...p, name: bannerNameError(name) })) }}
          error={errors.name}
        />
        <FileDropZone
          label="Banner image"
          hint="PNG, JPEG or WebP, up to 5 MB."
          required
          accept={BANNER_ACCEPT}
          acceptLabel={BANNER_ACCEPT_LABEL}
          maxBytes={BANNER_MAX_BYTES}
          onChange={(f) => {
            setFile(f)
            setErrors((p) => ({ ...p, image: undefined }))
          }}
          error={errors.image}
        />
        {errors.other && <Notice tone="danger" title="We could not save the banner">{errors.other}</Notice>}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" disabled={save.isPending} onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={save.isPending} busyLabel="Uploading…">Upload banner</Button>
        </div>
      </form>
    </Dialog>
  )
}

function DeleteDialog({ banner, onClose }: { banner: Banner | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => deleteBanner(id),
    onSuccess: () => {
      onClose()
      return queryClient.invalidateQueries({ queryKey: bannersKey })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'banner_not_found') {
        onClose()
        void queryClient.invalidateQueries({ queryKey: bannersKey })
        return
      }
      setError(errMsg(err))
    },
  })
  const close = () => {
    if (remove.isPending) return
    setError(null)
    onClose()
  }
  return (
    <Dialog open={banner !== null} onClose={close} title="Delete this banner?">
      {banner && (
        <div className={styles.form}>
          <p className={styles.confirmText}>
            <strong>{banner.name}</strong> will be removed from your banners. Videos you already made are not affected.
          </p>
          {error && <Notice tone="danger" title="We could not delete the banner">{error} The banner is still saved.</Notice>}
          <div className={styles.actions}>
            <Button variant="secondary" onClick={close}>Keep banner</Button>
            <Button
              variant="danger"
              busy={remove.isPending}
              busyLabel="Deleting…"
              onClick={() => {
                setError(null)
                remove.mutate(banner.id)
              }}
            >
              Delete banner
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

export default function BannersPage() {
  const [uploading, setUploading] = useState(false)
  const [toDelete, setToDelete] = useState<Banner | null>(null)
  const query = useBanners()
  const data = query.data

  let body
  if (query.isPending) {
    body = (
      <SkeletonGroup label="Loading your banners">
        <Skeleton height={200} />
        <Skeleton height={200} />
      </SkeletonGroup>
    )
  } else if (query.isError && !data) {
    body = <ErrorState title="We could not load your banners" message={errMsg(query.error)} onRetry={() => void query.refetch()} />
  } else if (data && data.length === 0) {
    body = (
      <EmptyState
        icon={<UploadIcon size={32} />}
        title="No banners yet"
        action={<Button onClick={() => setUploading(true)}>Upload your first banner</Button>}
      >
        Your uploaded banners appear here. You need one to make a video.
      </EmptyState>
    )
  } else if (data) {
    body = (
      <ul className={styles.grid}>
        {data.map((b) => (
          <li key={b.id} className={styles.card}>
            <img className={styles.preview} src={b.image_url} alt={`Preview of ${b.name}`} />
            <p className={styles.name}>{b.name}</p>
            <p className={styles.meta}>Uploaded {bannerDate(b.created_at)}</p>
            <div className={styles.cardActions}>
              <Button variant="quiet" onClick={() => setToDelete(b)} aria-label={`Delete banner: ${b.name}`}>Delete</Button>
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className={styles.page} aria-labelledby="h-banners">
      <div className={styles.head}>
        <h1 id="h-banners" className={styles.title}>Banners</h1>
        <Button onClick={() => setUploading(true)}>Upload banner</Button>
      </div>
      <p className={styles.intro}>{INTRO}</p>
      {query.isError && data && (
        <Notice tone="warning" title="We could not refresh your banners">
          {errMsg(query.error)} <button type="button" className={styles.textButton} onClick={() => void query.refetch()}>Try again</button>
        </Notice>
      )}
      {body}
      <DeleteDialog banner={toDelete} onClose={() => setToDelete(null)} />
      <UploadDialog open={uploading} onClose={() => setUploading(false)} />
    </section>
  )
}
