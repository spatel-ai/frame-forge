import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router'
import { ApiError, createScript, deleteScript, scriptsKey } from '../../api/client'
import type { SavedScript } from '../../api/client'
import type { ShellContext } from '../../components/AppShell'
import { Banner, Dialog, EmptyState, ErrorState, Pill, Skeleton, SkeletonGroup } from '../../components/feedback'
import { Button, Select, TextArea, TextField } from '../../components/form'
import { ScriptIcon } from '../../components/icons'
import { Pagination } from '../../components/layout'
import { errMsg } from '../../lib/util'
import { scriptMeta, useScriptFilters, useScripts } from '../../lib/scripts'
import styles from './scripts.module.css'

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
      } else setErrors({ other: `${errMsg(err)} Your text is still here; try again.` })
    },
  })
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim()) {
      setErrors({ script: 'Type what the person should say.' })
      return
    }
    save.mutate()
  }
  return (
    <Dialog open={open} onClose={onClose} title="New script">
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
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={errors.script}
        />
        {errors.other && <Banner tone="danger" title="We could not save the script">{errors.other}</Banner>}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
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
        <Skeleton height={96} />
        <Skeleton height={96} />
        <Skeleton height={96} />
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
      <EmptyState icon={<ScriptIcon size={32} />} title={f.q ? `No script matches "${f.q}"` : 'No script matches your filter'}>
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
        <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPageChange={f.setPage} />
      </>
    )
  }

  const showControls = !query.isPending && !emptyAll && !(query.isError && !data)

  return (
    <section className={styles.page} aria-labelledby="h-scripts">
      <div className={styles.head}>
        <h1 id="h-scripts" className={styles.title}>My scripts</h1>
        <Button onClick={() => setCreating(true)}>New script</Button>
      </div>
      <p className={styles.intro}>{INTRO}</p>
      {showControls && (
        <div className={styles.controls}>
          <TextField label="Search scripts" type="search" value={f.search} onChange={(e) => f.setSearch(e.target.value)} />
          <Select label="Language" value={f.language} onChange={(e) => f.setLanguage(e.target.value)}>
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
      {body}
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
