import type { SavedScript } from '../../api/client'
import { Dialog, EmptyState, ErrorState, Pill, Skeleton, SkeletonGroup } from '../../components/feedback'
import { Button, Select, TextField } from '../../components/form'
import { ScriptIcon } from '../../components/icons'
import { Pagination } from '../../components/layout'
import { scriptMeta, useScriptFilters, useScripts } from '../../lib/scripts'
import { errMsg } from '../../lib/util'
import styles from './ScriptPicker.module.css'

const PAGE_SIZE = 6

function PickerBody({
  languages,
  onChoose,
  onWriteNew,
}: {
  languages: string[]
  onChoose: (s: SavedScript) => void
  onWriteNew: () => void
}) {
  const f = useScriptFilters(PAGE_SIZE)
  const query = useScripts(f.params)
  const data = query.data
  const emptyAll = !!data && data.total === 0 && !f.filtered

  let body
  if (query.isPending) {
    body = (
      <SkeletonGroup label="Loading your scripts">
        <Skeleton height={64} />
        <Skeleton height={64} />
      </SkeletonGroup>
    )
  } else if (query.isError && !data) {
    body = <ErrorState title="We could not load your scripts" message={errMsg(query.error)} onRetry={() => void query.refetch()} />
  } else if (emptyAll) {
    body = (
      <EmptyState
        icon={<ScriptIcon size={32} />}
        title="No saved scripts yet"
        action={<Button onClick={onWriteNew}>Write a new script</Button>}
      >
        Every script you use is saved here automatically. Write your first script and it will be here next time.
      </EmptyState>
    )
  } else if (data && data.items.length === 0) {
    body = (
      <EmptyState
        icon={<ScriptIcon size={32} />}
        title={f.q ? `No script matches "${f.q}"` : 'No script matches your filter'}
        action={f.q ? <Button variant="secondary" onClick={f.clearSearch}>Clear search</Button> : undefined}
      >
        Check the spelling, or clear the search to see all your scripts.
      </EmptyState>
    )
  } else if (data) {
    body = (
      <>
        <ul className={styles.list}>
          {data.items.map((s) => (
            <li key={s.id}>
              <button type="button" className={styles.item} onClick={() => onChoose(s)}>
                <span className={styles.text}>{s.text}</span>
                <span className={styles.itemFoot}>
                  <span className={styles.meta}>{scriptMeta(s)}</span>
                  <Pill>{s.language}</Pill>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <Pagination page={data.page} pageSize={data.page_size} total={data.total} onPageChange={f.setPage} />
      </>
    )
  }

  return (
    <div className={styles.picker}>
      <p className={styles.lead}>Pick a script you used before. Its text and language fill in, and you can still change the words.</p>
      {!query.isPending && !emptyAll && !(query.isError && !data) && (
        <div className={styles.controls}>
          <TextField label="Search scripts" type="search" value={f.search} onChange={(e) => f.setSearch(e.target.value)} />
          <Select label="Language" value={f.language} onChange={(e) => f.setLanguage(e.target.value)}>
            <option value="">All</option>
            {languages.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        </div>
      )}
      {body}
    </div>
  )
}

/** Saved scripts of the customer, with search and a language filter. Choosing one calls `onChoose`. */
export function ScriptPickerDialog({
  open,
  onClose,
  languages,
  onChoose,
  onWriteNew,
}: {
  open: boolean
  onClose: () => void
  languages: string[]
  onChoose: (s: SavedScript) => void
  onWriteNew: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Choose from my scripts">
      <PickerBody languages={languages} onChoose={onChoose} onWriteNew={onWriteNew} />
    </Dialog>
  )
}
