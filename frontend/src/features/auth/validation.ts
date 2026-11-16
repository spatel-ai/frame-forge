import { useRef, useState } from 'react'

// Client rules mirror the server: name 1-80, email name@example.com, password 10-128.
export const EMAIL_MESSAGE = 'Enter a full email address, like name@example.com.'
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateName(name: string): string | undefined {
  const n = name.trim()
  if (!n) return 'Enter your name.'
  if (n.length > 80) return 'Use 80 characters or fewer.'
  return undefined
}

export function validateEmail(email: string): string | undefined {
  return EMAIL_SHAPE.test(email.trim()) ? undefined : EMAIL_MESSAGE
}

export function validateNewPassword(password: string): string | undefined {
  if (password.length < 10) return 'Use at least 10 characters.'
  if (password.length > 128) return 'Use 128 characters or fewer.'
  return undefined
}

export function validateCurrentPassword(password: string): string | undefined {
  return password ? undefined : 'Enter your password.'
}

export function validateConfirm(password: string, confirm: string): string | undefined {
  return password === confirm ? undefined : 'The two passwords are different. Type the same password in both boxes.'
}

/** Accept `next` only as a same-site path: starts with one "/" and not "//" (or "/\"). */
export function safeNext(next: string | null | undefined, fallback = '/create'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}

type Validators<K extends string> = Record<K, (values: Record<K, string>) => string | undefined>

/**
 * Form state for the auth screens (UX.md section 6): a field is validated when it is left, then live;
 * submit validates everything and focuses the first invalid field. Server `fields` errors show under
 * the same field and clear when the person edits it.
 */
export function useFields<K extends string>(initial: Record<K, string>, validators: Validators<K>, order: K[]) {
  const [values, setValues] = useState(initial)
  const [checked, setChecked] = useState<Partial<Record<K, boolean>>>({})
  const [serverErrors, setServerErrors] = useState<Partial<Record<K, string>>>({})
  const refs = useRef<Partial<Record<K, HTMLInputElement | null>>>({})

  const clientError = (k: K) => (checked[k] ? validators[k](values) : undefined)
  const error = (k: K) => clientError(k) ?? serverErrors[k]
  const focus = (k: K) => refs.current[k]?.focus()

  return {
    values,
    error,
    /** True once the field has been checked and has no error (for "Looks good"). */
    valid: (k: K) => Boolean(checked[k]) && !error(k) && values[k] !== '',
    ref: (k: K) => (el: HTMLInputElement | null) => {
      refs.current[k] = el
    },
    set: (k: K, value: string) => {
      setValues((prev) => ({ ...prev, [k]: value }))
      setServerErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev))
    },
    blur: (k: K) => setChecked((prev) => ({ ...prev, [k]: true })),
    /** Validate every field; focus the first invalid one. Returns true when all are valid. */
    checkAll: () => {
      setChecked(Object.fromEntries(order.map((k) => [k, true])) as Record<K, boolean>)
      setServerErrors({})
      const first = order.find((k) => validators[k](values))
      if (first) focus(first)
      return !first
    },
    /** Show server field errors; returns true if any matched a field here. */
    showServerErrors: (fields: Record<string, string>) => {
      const mine: Partial<Record<K, string>> = {}
      for (const k of order) if (fields[k]) mine[k] = fields[k]
      const first = order.find((k) => mine[k])
      if (!first) return false
      setServerErrors(mine)
      focus(first)
      return true
    },
    setServerError: (k: K, message: string) => {
      setServerErrors({ [k]: message } as Partial<Record<K, string>>)
      focus(k)
    },
    focus,
  }
}
