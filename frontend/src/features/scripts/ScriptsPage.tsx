import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { ApiError, createScript, deleteScript, scriptsKey } from '../../api/client'
import type { SavedScript } from '../../api/client'
import type { ShellContext } from '../../components/AppShell'
import { Banner, Dialog, EmptyState, ErrorState, Pill, Skeleton, SkeletonGroup } from '../../components/feedback'
import { Button, countChars, Select, TextArea, TextField } from '../../components/form'
import { ScriptIcon } from '../../components/icons'
import { Pagination } from '../../components/layout'
import { errMsg } from '../../lib/util'
import { scriptMeta, useScriptFilters, useScripts } from '../../lib/scripts'
import { capSearch, HEADING_QUERY_CHARS, overLimitMessage, saveErrorText, shortQuery, validateScriptText } from './scriptText'
import styles from './scripts.module.css'

const SKELETON_ROWS = 3
const PAGE_SIZE = 10
const INTRO = 'Every script you use is saved here automatically. Deleting a script never changes a video you already made.'

function NewScriptDialog({ open, onClose, languages, maxChars }: {
  open: boolean
  onClose: () => void
  languages: string[]
  maxChars: number | undefined
}) {
  const queryClient = useQueryClient()
  const [language, setLanguage] = useState(languages[0] ?? '')
  const [text, setText] = useState('')
  const [errors, setErrors] = useState<{ script?: string; language?: string; other?: string }>({})
  const textRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!language && languages[0]) setLanguage(languages[0])
  }, [language, languages])
  const save = useMutation({
    mutationFn: () => createScript(language, text),
    onSuccess: () => {
      setText('')
      setErrors({})
      onClose()
      return queryClient.invalidateQueries({ queryKey: scriptsKey })
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.fields.script || err.fields.language)) {
        setErrors({ script: err.fields.script, language: err.fields.language })
      } else setErrors({ other: saveErrorText(err) })
    },
  })
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const problem = validateScriptText(text, maxChars)
    if (problem) {
      setErrors({ script: problem })
      textRef.current?.focus()
      return
    }
    setErrors((prev) => ({ ...prev, other: undefined }))
    save.mutate()
  }
  // Closing (Escape, Cancel, backdrop) forgets an old save error; the typed text is kept.
  const close = () => {
    setErrors((prev) => (prev.other ? { ...prev, other: undefined } : prev))
    onClose()
  }
  return (
    <Dialog open={open} onClose={close} title="New script">
      <form className={styles.confirm} onSubmit={submit} noValidate>
        <p className={styles.confirmText}>Save a script to use later. No voice is made and no credits are taken.</p>
        <Select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} error={errors.language}>
          {languages.map((l) => <option key={l} value={l}>{l}</option>)}
        </Select>
        <TextArea
          label="What should the person say?"
          hint={maxChars ? `Up to ${maxChars} characters.` : undefined}
          max={maxChars}
          rows={6}
          ref={textRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            // After a first error the field is checked on every change and the message clears when it is fixed.
            if (errors.script) setErrors((prev) => ({ ...prev, script: validateScriptText(e.target.value, maxChars) }))
          }}
          error={errors.script ?? overLimitMessage(text, maxChars)}
        />
        {errors.other && <Banner tone="danger" title="We could not save the script">{errors.other}</Banner>}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
          <Button type="submit" busy={save.isPending} busyLabel="Saving…">Save script</Button>
        </div>
      </form>
    </Dialog>
  )
}

function DeleteDialog({ script, onClose }: { script: SavedScript | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const remove = useMutation({
    mutationFn: (id: string) => deleteScript(id),
    onSuccess: () => {
      onClose()
      return queryClient.invalidateQueries({ queryKey: scriptsKey })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'script_not_found') {
        // Already gone (another tab): the list is simply out of date.
        onClose()
        void queryClient.invalidateQueries({ queryKey: scriptsKey })
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
    <Dialog open={script !== null} onClose={close} title="Delete this script?">
      {script && (
        <div className={styles.confirm}>
          <p className={styles.quote}>{script.text}</p>
          <p className={styles.confirmText}>
            This removes the script from My scripts. Videos you already made are not affected, and no credits are involved.
          </p>
          {error && <Banner tone="danger" title="We could not delete the script">{error} The script is still saved.</Banner>}
          <div className={styles.actions}>
            <Button variant="secondary" onClick={close}>Keep script</Button>
            <Button
              variant="danger"
              busy={remove.isPending}
              busyLabel="Deleting…"
              onClick={() => {
                setError(null)
                remove.mutate(script.id)
              }}
            >
              Delete script
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

export default function ScriptsPage() {
  const [creating, setCreating] = useState(false)
  const { config } = useOutletContext<ShellContext>()
  const f = useScriptFilters(PAGE_SIZE)
  const query = useScripts(f.params)
  const [toDelete, setToDelete] = useState<SavedScript | null>(null)
  const data = query.data
  const resultsRef = useRef<HTMLDivElement>(null)
  // 'page': the customer changed page (scroll to the list and move focus). 'filter': a search or filter
  // replaced the list (scroll only if the list top is above the screen; focus stays in the search box).
  const pending = useRef<'page' | 'filter' | null>(null)
  const goToPage = (p: number) => {
    pending.current = 'page'
    f.setPage(p)
  }
  const filterKey = `${f.q}\u0000${f.language}`
  const lastFilterKey = useRef(filterKey)
  useEffect(() => {
    if (lastFilterKey.current === filterKey) return
    lastFilterKey.current = filterKey
    if (pending.current !== 'page') pending.current = 'filter'
  }, [filterKey])
  const settled = !!data && !query.isPlaceholderData
  useEffect(() => {
    const el = resultsRef.current
    const kind = pending.current
    if (!settled || !el || !kind) return
    pending.current = null
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth'
    if (kind === 'page') {
      el.scrollIntoView?.({ block: 'start', behavior })
      el.focus({ preventScroll: true })
    } else if (el.getBoundingClientRect().top < 0) {
      el.scrollIntoView?.({ block: 'start', behavior })
    }
  }, [settled, data])

  // After deleting the last row of a page, step back to the last page that still has rows.
  const { setPage } = f
  useEffect(() => {
    if (data && data.items.length === 0 && data.total > 0 && data.page > 1) {
      setPage(Math.ceil(data.total / data.page_size))
    }
  }, [data, setPage])

  const languages = config?.languages ?? []
  const emptyAll = !!data && data.total === 0 && !f.filtered

  let body
  if (query.isPending) {
    body = (
      <SkeletonGroup label="Loading your scripts">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <div key={i} className={styles.skeletonRow}><Skeleton height="100%" /></div>
        ))}
      </SkeletonGroup>
    )
  } else if (query.isError && !data) {
    body = <ErrorState title="We could not load your scripts" message={errMsg(query.error)} onRetry={() => void query.refetch()} />
  } else if (emptyAll) {
    body = (
      <EmptyState icon={<ScriptIcon size={32} />} title="No saved scripts yet" action={<Link className={styles.linkButton} to="/create">Create a video</Link>}>
        The first script you use to make a video is saved here, so you can use it again.
      </EmptyState>
    )
  } else if (data && data.items.length === 0) {
    body = (
      <EmptyState icon={<ScriptIcon size={32} />} title={f.q ? `No script matches "${shortQuery(f.q)}"` : 'No script matches your filter'}>
        {f.q && countChars(f.q) > HEADING_QUERY_CHARS && <span className={styles.srOnly}>You searched for "{f.q}". </span>}
        Check the spelling, or clear the search and the language filter to see all your scripts.
      </EmptyState>
    )
  } else if (data) {
    body = (
      <>
        <ul className={styles.list}>
          {data.items.map((s) => (
            <li key={s.id} className={styles.row}>
              <div className={styles.main}>
                <p className={styles.text}>{s.text}</p>
                <p className={styles.meta}>{scriptMeta(s)}</p>
              </div>
              <Pill>{s.language}</Pill>
              <div className={styles.rowActions}>
                <Link className={styles.linkButton} to={`/create?script=${encodeURIComponent(s.id)}`}>Use this script</Link>
                <Button variant="quiet" onClick={() => setToDelete(s)} aria-label={`Delete script: ${s.text.slice(0, 40)}`}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
        <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPageChange={goToPage} />
      </>
    )
  }

  // Shown while the first load runs (disabled) and after an error, so the customer can always change the search.
  const showControls = !emptyAll

  return (
    <section className={styles.page} aria-labelledby="h-scripts">
      <div className={styles.head}>
        <h1 id="h-scripts" className={styles.title}>My scripts</h1>
        <Button onClick={() => setCreating(true)}>New script</Button>
      </div>
      <p className={styles.intro}>{INTRO}</p>
      {showControls && (
        <div className={styles.controls}>
          <TextField
            label="Search scripts"
            type="search"
            disabled={query.isPending}
            value={f.search}
            onChange={(e) => f.setSearch(capSearch(e.target.value))}
          />
          <Select label="Language" disabled={query.isPending} value={f.language} onChange={(e) => f.setLanguage(e.target.value)}>
            <option value="">All</option>
            {languages.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        </div>
      )}
      {query.isError && data && (
        <Banner tone="warning" title="We could not refresh your scripts">
          {errMsg(query.error)} <button type="button" className={styles.textButton} onClick={() => void query.refetch()}>Try again</button>
        </Banner>
      )}
      <div ref={resultsRef} role="region" aria-label="Your scripts" tabIndex={-1} className={styles.results}>
        {body}
      </div>
      <DeleteDialog script={toDelete} onClose={() => setToDelete(null)} />
      <NewScriptDialog
        open={creating}
        onClose={() => setCreating(false)}
        languages={languages}
        maxChars={config?.max_script_chars}
      />
    </section>
  )
}
