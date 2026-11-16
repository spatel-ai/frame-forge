import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Select } from './Select'

function renderSelect(props: Partial<React.ComponentProps<typeof Select>> = {}) {
  return render(
    <Select label="Language" {...props}>
      <option value="en">English</option>
      <option value="hi">Hindi</option>
    </Select>,
  )
}

describe('Select', () => {
  it('associates the label with the native select', () => {
    renderSelect()
    const select = screen.getByLabelText('Language')
    expect(select.tagName).toBe('SELECT')
    expect(screen.getAllByRole('option')).toHaveLength(2)
  })

  it('takes focus by keyboard and changes value', async () => {
    const user = userEvent.setup()
    renderSelect()
    await user.tab()
    const select = screen.getByLabelText('Language') as HTMLSelectElement
    expect(document.activeElement).toBe(select)
    await user.selectOptions(select, 'hi')
    expect(select.value).toBe('hi')
  })

  it('error state: aria-invalid and described by the error', () => {
    renderSelect({ error: 'Choose a language', hint: 'Matches your script' })
    const select = screen.getByLabelText('Language')
    expect(select.getAttribute('aria-invalid')).toBe('true')
    const texts = (select.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
    expect(texts).toEqual(['Matches your script', 'Choose a language'])
  })

  it('can be disabled', () => {
    renderSelect({ disabled: true })
    expect((screen.getByLabelText('Language') as HTMLSelectElement).disabled).toBe(true)
  })
})
