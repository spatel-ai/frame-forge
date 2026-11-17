// The layout checks. Each runs inside the page (real layout), and returns named offenders:
// selector, visible text and measured size, so a builder can act on them.
import type { Page } from '@playwright/test'

export const CHECKS = [
  { id: 'no-sideways-scroll', title: 'No sideways scroll' },
  { id: 'tap-targets', title: 'Tap targets at least 44 px tall' },
  { id: 'input-font-size', title: 'Inputs at least 16 px on phones' },
  { id: 'bottom-bar-clear', title: 'Last control not under the bottom bar (phones)' },
] as const
export type CheckId = (typeof CHECKS)[number]['id']

export type Offender = { selector: string; text: string; size: string; detail?: string }
export type CheckResult = { id: CheckId; applies: boolean; offenders: Offender[] }

type Options = { phone: boolean; dialog: boolean }

/** Checks 1 to 3, measured at the top of the page. */
export async function measureTop(page: Page, opts: Options): Promise<CheckResult[]> {
  const out = await page.evaluate(({ phone, dialog }) => {
    const root: ParentNode = (dialog ? document.querySelector('dialog[open]') : document.body) ?? document.body
    const vw = document.documentElement.clientWidth
    const rectOf = (el: Element) => el.getBoundingClientRect()
    const fmt = (n: number) => String(Math.round(n * 10) / 10)
    const selector = (el: Element) => {
      const parts: string[] = []
      let e: Element | null = el
      for (let i = 0; e && i < 4 && e !== document.body; i++) {
        let s = e.localName
        if (e.id && !/^(_r_|:r)/.test(e.id)) {
          parts.unshift(`${s}#${e.id}`) // React's generated ids (_r_0_) are not stable names
          break
        }
        const cls = [...e.classList].slice(0, 2).join('.')
        if (cls) s += `.${cls}`
        const name = e.getAttribute('name') ?? e.getAttribute('type')
        if (name && ['input', 'select', 'textarea', 'button'].includes(s.split('.')[0])) s += `[${e.getAttribute('name') ? 'name' : 'type'}=${name}]`
        parts.unshift(s)
        e = e.parentElement
      }
      return parts.join(' > ')
    }
    const label = (el: Element) => {
      const h = el as HTMLElement & { value?: string; alt?: string }
      const own = (el as HTMLInputElement).labels?.[0]?.innerText
      const t = (el.getAttribute('aria-label') || h.innerText || h.value || h.alt || own || el.getAttribute('placeholder') || '')
        .trim()
        .replace(/\s+/g, ' ')
      return t.slice(0, 50)
    }
    const shown = (el: Element) => {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false
      const r = rectOf(el)
      return r.width > 0 && r.height > 0
    }

    // 1. No sideways scroll.
    const overflow: { el: Element; by: number }[] = []
    const all = [...root.querySelectorAll('*')]
    for (const el of all) {
      if (el.closest('svg') && el.localName !== 'svg') continue
      const r = rectOf(el)
      if (r.width <= 1 || r.height <= 1 || r.right <= vw + 0.5 || !shown(el)) continue
      let clipped = false
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        if (p === document.body) break
        const ox = getComputedStyle(p).overflowX
        if (ox !== 'visible' && rectOf(p).right <= vw + 0.5) {
          clipped = true
          break
        }
      }
      if (!clipped) overflow.push({ el, by: r.right - vw })
    }
    const leaves = overflow.filter((a) => !overflow.some((b) => b.el !== a.el && a.el.contains(b.el)))
    leaves.sort((a, b) => b.by - a.by)
    const sideways: Offender[] = []
    const doc = document.documentElement
    if (doc.scrollWidth > doc.clientWidth) {
      sideways.push({
        selector: 'html',
        text: '',
        size: `scrollWidth ${doc.scrollWidth} > clientWidth ${doc.clientWidth}`,
      })
    }
    for (const { el, by } of leaves.slice(0, 8)) {
      const r = rectOf(el)
      sideways.push({ selector: selector(el), text: label(el), size: `${fmt(r.width)}x${fmt(r.height)}`, detail: `right edge ${fmt(by)} px past the viewport` })
    }

    // 2. Tap targets.
    const CANDIDATES = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=switch]'
    const inSentence = (el: Element) => {
      if (el.localName !== 'a') return false
      if (getComputedStyle(el).display !== 'inline') return false
      const parent = el.parentElement
      if (!parent) return false
      return [...parent.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0)
    }
    const targetOf = (el: Element): Element | null => {
      if (el instanceof HTMLInputElement && ['checkbox', 'radio', 'file'].includes(el.type)) {
        const lab = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null)
        if (lab) return lab
        const r = rectOf(el)
        return r.width <= 2 || r.height <= 2 ? null : el
      }
      return el
    }
    const targets = new Set<Element>()
    for (const el of root.querySelectorAll(CANDIDATES)) {
      if (inSentence(el)) continue
      const t = targetOf(el)
      // Not on screen at all (a skip link parked above the page, a drawer parked off to the left): not a target.
      if (t && shown(t) && rectOf(t).right > 0 && rectOf(t).bottom > 0) targets.add(t)
    }
    const small: Offender[] = []
    for (const t of targets) {
      const r = rectOf(t)
      if (r.height < 43.5) {
        small.push({ selector: selector(t), text: label(t), size: `${fmt(r.width)}x${fmt(r.height)}`, detail: `${fmt(r.height)} px tall` })
      }
    }

    // 3. Input font size on phones.
    const fonts: Offender[] = []
    if (phone) {
      const TEXTY = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]):not([type=submit]):not([type=button]):not([type=range]):not([type=color]):not([type=image]):not([type=reset]), textarea, select'
      for (const el of root.querySelectorAll(TEXTY)) {
        if (!shown(el)) continue
        const size = parseFloat(getComputedStyle(el).fontSize)
        if (size < 16) {
          const r = rectOf(el)
          fonts.push({ selector: selector(el), text: label(el), size: `${fmt(r.width)}x${fmt(r.height)}`, detail: `font-size ${size} px` })
        }
      }
    }
    return { sideways, small, fonts }
  }, opts)
  return [
    { id: 'no-sideways-scroll', applies: true, offenders: out.sideways },
    { id: 'tap-targets', applies: true, offenders: out.small },
    { id: 'input-font-size', applies: opts.phone, offenders: out.fonts },
  ]
}

/** Check 4: scroll everything to the bottom, then see whether the last control is reachable. */
export async function measureBottom(page: Page, opts: Options): Promise<CheckResult> {
  if (!opts.phone) return { id: 'bottom-bar-clear', applies: false, offenders: [] }
  const offenders = await page.evaluate(async ({ dialog }) => {
    const root: ParentNode = (dialog ? document.querySelector('dialog[open]') : document.body) ?? document.body
    const fmt = (n: number) => String(Math.round(n * 10) / 10)
    const selector = (el: Element) => {
      const parts: string[] = []
      let e: Element | null = el
      for (let i = 0; e && i < 4 && e !== document.body; i++) {
        let s = e.localName
        if (e.id && !/^(_r_|:r)/.test(e.id)) {
          parts.unshift(`${s}#${e.id}`) // React's generated ids (_r_0_) are not stable names
          break
        }
        const cls = [...e.classList].slice(0, 2).join('.')
        if (cls) s += `.${cls}`
        const name = e.getAttribute('name') ?? e.getAttribute('type')
        if (name && ['input', 'select', 'textarea', 'button'].includes(s.split('.')[0])) s += `[${e.getAttribute('name') ? 'name' : 'type'}=${name}]`
        parts.unshift(s)
        e = e.parentElement
      }
      return parts.join(' > ')
    }
    const label = (el: Element) => {
      const h = el as HTMLElement & { value?: string }
      return (el.getAttribute('aria-label') || h.innerText || h.value || (el as HTMLInputElement).labels?.[0]?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50)
    }
    const shown = (el: Element) => {
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    // Scroll the window and every scrollable box to its end, without animation.
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el)
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'instant' })
      }
    }
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    await new Promise((r) => setTimeout(r, 250))

    const vh = window.innerHeight
    const bars = [...root.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el)
      if (cs.position !== 'fixed' && cs.position !== 'sticky') return false
      if (!shown(el)) return false
      const r = el.getBoundingClientRect()
      return r.bottom >= vh - 2 && r.top > vh * 0.4 && r.height < vh * 0.5
    })
    const CANDIDATES = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab]'
    let last: { el: Element; r: DOMRect } | null = null
    for (const el of root.querySelectorAll(CANDIDATES)) {
      if (bars.some((b) => b.contains(el))) continue
      const t =
        el instanceof HTMLInputElement && ['checkbox', 'radio', 'file'].includes(el.type) ? (el.closest('label') ?? el) : el
      if (!shown(t)) continue
      const r = t.getBoundingClientRect()
      if (r.right <= 0 || r.bottom <= 0) continue // scrolled out of view above (a top bar): not the last control
      if (!last || r.bottom > last.r.bottom) last = { el: t, r }
    }
    const out: { selector: string; text: string; size: string; detail?: string }[] = []
    if (!last) return out
    const { el, r } = last
    const size = `${fmt(r.width)}x${fmt(r.height)}`
    for (const b of bars) {
      const br = b.getBoundingClientRect()
      if (r.bottom > br.top + 0.5 && r.top < br.bottom && r.right > br.left && r.left < br.right) {
        out.push({ selector: selector(el), text: label(el), size, detail: `bottom ${fmt(r.bottom)} is under the fixed bar ${selector(b)} that starts at ${fmt(br.top)} (viewport ${vh})` })
        return out
      }
    }
    if (r.bottom > vh + 0.5) {
      out.push({ selector: selector(el), text: label(el), size, detail: `bottom ${fmt(r.bottom)} is below the viewport ${vh} after scrolling to the end` })
      return out
    }
    const cx = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1)
    const cy = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1)
    const hit = document.elementFromPoint(cx, cy)
    if (hit && !el.contains(hit) && !hit.contains(el)) {
      out.push({ selector: selector(el), text: label(el), size, detail: `covered by ${selector(hit)}` })
    }
    return out
  }, { dialog: opts.dialog })
  return { id: 'bottom-bar-clear', applies: true, offenders }
}
