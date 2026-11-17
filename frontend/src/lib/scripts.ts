import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { listScripts, scriptListKey } from '../api/client'
import { countChars } from '../components/form'
import type { SavedScript, ScriptListParams } from '../api/client'

/** Shared by My scripts and the Create picker (features may not import each other). */
const DEBOUNCE_MS = 300

const dayMonth = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })
const dayMonthYear = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** "today", "yesterday", "12 Nov", or "12 Nov 2025" for another year. */
export function formatLastUsed(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const days = Math.round((startOfDay(now) - startOfDay(then)) / MS_PER_DAY)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return then.getFullYear() === now.getFullYear() ? dayMonth.format(then) : dayMonthYear.format(then)
}

/** "English · 171 characters · Last used yesterday" */
export function scriptMeta(s: SavedScript, now?: Date): string {
  const n = countChars(s.text)
  return `${s.language} · ${n} ${n === 1 ? 'character' : 'characters'} · Last used ${formatLastUsed(s.last_used_at, now)}`
}

export type ScriptFilters = {
  search: string
  setSearch: (v: string) => void
  /** The debounced, trimmed search that is actually sent. */
  q: string
  language: string
  setLanguage: (v: string) => void
  page: number
  setPage: (p: number) => void
  params: ScriptListParams
  filtered: boolean
  clearSearch: () => void
}

/** Search (debounced), language filter and page for a script list; any change of filter returns to page 1. */
export function useScriptFilters(pageSize: number): ScriptFilters {
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [language, setLanguageState] = useState('')
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (search.trim() === q) return
    const t = setTimeout(() => {
      setQ(search.trim())
      setPage(1)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search, q])

  return {
    search,
    setSearch,
    q,
    language,
    setLanguage: (v) => {
      setLanguageState(v)
      setPage(1)
    },
    page,
    setPage,
    params: { page, page_size: pageSize, q, language },
    filtered: q !== '' || language !== '',
    clearSearch: () => {
      setSearch('')
      setQ('')
      setPage(1)
    },
  }
}

export function useScripts(params: ScriptListParams, enabled = true) {
  return useQuery({
    queryKey: scriptListKey(params),
    queryFn: () => listScripts(params),
    placeholderData: keepPreviousData,
    retry: false,
    enabled,
  })
}
