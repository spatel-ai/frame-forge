import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Banner } from '../../api/client'
import type { useBanners } from '../../lib/banners'
import { BannerPicker } from './BannerPicker'

const ROW = 100
const CARD = 90

const banner = (i: number): Banner => ({ id: `b${i}`, name: `Banner ${i}`, image_url: `/img/b${i}`, created_at: '2026-11-10T10:00:00Z' })
const loaded = (n: number) =>
  ({ data: Array.from({ length: n }, (_, i) => banner(i + 1)), isPending: false, isError: false }) as unknown as ReturnType<typeof useBanners>

function renderPicker(n: number, selected: string | null = null, onSelect = vi.fn()) {
  render(
    <MemoryRouter>
      <BannerPicker banners={loaded(n)} selected={selected} onSelect={onSelect} error={null} disabled={false} />
    </MemoryRouter>,
  )
  return onSelect
}

const list = () => document.querySelector<HTMLElement>('fieldset > div') as HTMLElement
const wrapper = () => list().closest('fieldset')?.parentElement as HTMLElement

// jsdom has no layout: on a phone (one column) card i sits at i * ROW px, CARD px tall.
let scrollTops: number[]
beforeEach(() => {
  scrollTops = []
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const cards = this.parentElement ? Array.from(this.parentElement.children) : []
    const i = this.tagName === 'LABEL' ? cards.indexOf(this) : 0
    const top = this.tagName === 'LABEL' ? i * ROW : 0
    const height = this.tagName === 'LABEL' ? CARD : 0
    return { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.tagName === 'LABEL' ? CARD : 0
  })
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation((v: number) => {
    scrollTops.push(v)
  })
})
afterEach(() => vi.restoreAllMocks())

describe('BannerPicker: many banners on a phone', () => {
  it('R-85: up to 5 banners the list keeps its natural height', () => {
    renderPicker(5)
    expect(wrapper().style.getPropertyValue('--cards-cap')).toBe('')
    expect(wrapper().className).not.toMatch(/capped/)
  })

  it('R-85: more than 5 banners cap the list at four and a half cards, which then scrolls by itself', () => {
    renderPicker(20)
    // The fifth card starts at 4 * ROW; half of it shows.
    expect(wrapper().style.getPropertyValue('--cards-cap')).toBe(`${4 * ROW + CARD / 2}px`)
    expect(wrapper().className).toMatch(/capped/)
    expect(screen.getAllByRole('radio')).toHaveLength(20)
  })

  it('R-85: a banner chosen when the step opens is scrolled into view inside the list', () => {
    renderPicker(20, 'b15')
    // Card 15 is at 14 * ROW; it is brought to the middle of the list (no page scroll is asked for).
    expect(scrollTops.length).toBeGreaterThan(0)
    expect(scrollTops.at(-1)).toBe(14 * ROW - (0 - CARD) / 2)
  })

  // Arrow keys themselves are the browser's (jsdom has none): they focus and check the next radio,
  // which is what this test does. Checked with real arrow keys in Chromium and WebKit.
  it('R-85: a card chosen from the keyboard (its radio focused) is scrolled into view', () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    let selected: string | null = 'b1'
    const onSelect = vi.fn((id: string) => (selected = id))
    const { rerender } = render(
      <MemoryRouter>
        <BannerPicker banners={loaded(8)} selected={selected} onSelect={onSelect} error={null} disabled={false} />
      </MemoryRouter>,
    )
    const next = screen.getByRole('radio', { name: /Banner 2$/ })
    next.focus()
    fireEvent.click(next)
    expect(onSelect).toHaveBeenLastCalledWith('b2')
    rerender(
      <MemoryRouter>
        <BannerPicker banners={loaded(8)} selected={selected} onSelect={onSelect} error={null} disabled={false} />
      </MemoryRouter>,
    )
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /Banner 2$/ }))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  })

  it('R-85: no banners shows the notice with "Upload a banner" as its own action link', () => {
    renderPicker(0)
    const link = screen.getByRole('link', { name: 'Upload a banner' })
    expect(link.getAttribute('href')).toBe('/banners')
    expect(link.className).toMatch(/textLink/)
  })
})
