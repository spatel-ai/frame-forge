import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SelectableCard } from './SelectableCard'
import { SelectableCardGroup } from './SelectableCardGroup'

function renderGroup(props: Partial<React.ComponentProps<typeof SelectableCardGroup>> = {}) {
  return render(
    <SelectableCardGroup legend="Start banner" name="start" {...props}>
      <SelectableCard value="none" label="None" description="No banner" />
      <SelectableCard value="a" label="Sale" media={<span>preview</span>} />
      <SelectableCard value="b" label="Launch" />
    </SelectableCardGroup>,
  )
}

describe('SelectableCard', () => {
  it('renders a fieldset with legend and native radios sharing the name', () => {
    renderGroup()
    expect(screen.getByRole('group', { name: 'Start banner' })).toBeTruthy()
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios).toHaveLength(3)
    expect(radios.every((r) => r.name === 'start')).toBe(true)
    expect(radios.every((r) => !r.checked)).toBe(true)
  })

  it('label association: radio is named by the card title; media and description render', () => {
    renderGroup()
    expect(screen.getByLabelText(/None/)).toBeTruthy()
    expect(screen.getByText('No banner')).toBeTruthy()
    expect(screen.getByText('preview')).toBeTruthy()
  })

  it('clicking a card selects it and only one in the group is checked', async () => {
    const user = userEvent.setup()
    renderGroup()
    await user.click(screen.getByText('Sale'))
    await user.click(screen.getByText('Launch'))
    const checked = (screen.getAllByRole('radio') as HTMLInputElement[]).filter((r) => r.checked)
    expect(checked.map((r) => r.value)).toEqual(['b'])
  })

  // Arrow-key movement between radios is native browser behaviour; user-event cannot exercise it in jsdom.
  it('keyboard: Tab focuses the first radio and Space selects it', async () => {
    const user = userEvent.setup()
    renderGroup()
    await user.tab()
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(document.activeElement).toBe(radios[0])
    await user.keyboard(' ')
    expect(radios[0]?.checked).toBe(true)
  })

  it('error state: group is aria-invalid and described by the error', () => {
    renderGroup({ error: 'Choose a banner', hint: 'Banners are free' })
    const group = screen.getByRole('group', { name: 'Start banner' })
    expect(group.getAttribute('aria-invalid')).toBe('true')
    const texts = (group.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
    expect(texts).toEqual(['Banners are free', 'Choose a banner'])
  })

  it('a disabled card cannot be selected', async () => {
    const user = userEvent.setup()
    render(<SelectableCard name="x" value="1" label="Locked" disabled />)
    const radio = screen.getByLabelText(/Locked/) as HTMLInputElement
    await user.click(radio)
    expect(radio.disabled).toBe(true)
    expect(radio.checked).toBe(false)
  })

  it('shows the word "Selected" markup for each card (visible only when checked, via CSS)', () => {
    renderGroup()
    expect(screen.getAllByText('Selected')).toHaveLength(3)
  })
})
