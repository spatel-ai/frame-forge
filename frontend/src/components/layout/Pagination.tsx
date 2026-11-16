import { ChevronLeftIcon, ChevronRightIcon } from '../icons'
import styles from './Pagination.module.css'

export interface PaginationProps {
  /** Current page, counting from 1. */
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <nav className={styles.nav} aria-label="Pagination">
      <p className={styles.summary}>Showing {from}–{to} of {total}</p>
      <div className={styles.buttons}>
        <button type="button" className={styles.button} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeftIcon size={18} /> Previous
        </button>
        <button type="button" className={styles.button} disabled={page >= lastPage} onClick={() => onPageChange(page + 1)}>
          Next <ChevronRightIcon size={18} />
        </button>
      </div>
    </nav>
  )
}
