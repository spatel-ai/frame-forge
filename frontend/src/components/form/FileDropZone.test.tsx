import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileDropZone } from './FileDropZone'

const MB = 1024 * 1024
const createObjectURL = vi.fn(() => 'blob:preview-1')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  URL.createObjectURL = createObjectURL
  URL.revokeObjectURL = revokeObjectURL
})
afterEach(() => {
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
})

function png(name = 'me.png', size = 1000) {
  return new File([new Uint8Array(size)], name, { type: 'image/png' })
}

function setup(props: Partial<React.ComponentProps<typeof FileDropZone>> = {}) {
  const onChange = vi.fn()
  const user = userEvent.setup({ applyAccept: false })
  render(
    <FileDropZone
      label="Photo"
      hint="JPEG, PNG or WebP, up to 10 MB"
      accept="image/jpeg,image/png,image/webp"
      acceptLabel="a JPEG, PNG or WebP image"
      maxBytes={10 * MB}
      onChange={onChange}
      {...props}
    />,
  )
  return { onChange, user, input: () => screen.getByLabelText('Photo') as HTMLInputElement }
}

describe('FileDropZone', () => {
  it('renders a real file input labelled by the field label, with the hint', () => {
    const { input } = setup()
    expect(input().type).toBe('file')
    expect(input().accept).toBe('image/jpeg,image/png,image/webp')
    const hint = document.getElementById(input().getAttribute('aria-describedby') ?? '')
    expect(hint?.textContent).toBe('JPEG, PNG or WebP, up to 10 MB')
  })

  it('the input is reachable by keyboard', async () => {
    const { user, input } = setup()
    await user.tab()
    expect(document.activeElement).toBe(input())
  })

  it('accepts a valid file, calls onChange and shows a preview', async () => {
    const { user, input, onChange } = setup()
    const file = png()
    await user.upload(input(), file)
    expect(onChange).toHaveBeenCalledWith(file)
    expect((await screen.findByAltText('Preview of me.png') as HTMLImageElement).src).toBe('blob:preview-1')
    expect(screen.getByText('me.png')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('rejects a wrong type with a message that says what to do', async () => {
    const { user, input, onChange } = setup()
    await user.upload(input(), new File(['x'], 'doc.pdf', { type: 'application/pdf' }))
    expect(screen.getByRole('alert').textContent).toBe('That file type is not supported. Choose a JPEG, PNG or WebP image.')
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(input().getAttribute('aria-invalid')).toBe('true')
    const ids = (input().getAttribute('aria-describedby') ?? '').split(' ')
    expect(document.getElementById(ids[ids.length - 1] ?? '')?.textContent).toContain('not supported')
  })

  it('rejects a file that is too large with a message that says what to do', async () => {
    const { user, input, onChange } = setup()
    await user.upload(input(), png('big.png', 11 * MB))
    expect(screen.getByRole('alert').textContent).toBe('That file is 11 MB. Choose one up to 10 MB.')
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('rounds an over-limit size up, so it never reads as equal to the limit', async () => {
    const { user, input } = setup()
    await user.upload(input(), png('big.png', 10 * MB + 2000))
    expect(screen.getByRole('alert').textContent).toBe('That file is 10.1 MB. Choose one up to 10 MB.')
  })

  it('Remove clears the file, the preview and calls onChange(null); preview URL is revoked', async () => {
    const { user, input, onChange } = setup()
    await user.upload(input(), png())
    await screen.findByAltText('Preview of me.png')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
    expect(screen.queryByAltText('Preview of me.png')).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
  })

  it('Replace opens the file chooser (clicks the input)', async () => {
    const { user, input } = setup()
    await user.upload(input(), png())
    const click = vi.spyOn(input(), 'click')
    await user.click(screen.getByRole('button', { name: 'Replace' }))
    expect(click).toHaveBeenCalled()
  })

  it('revokes the preview URL on unmount', async () => {
    const { user, input } = setup()
    await user.upload(input(), png())
    await screen.findByAltText('Preview of me.png')
    // unmount via cleanup
    const { cleanup } = await import('@testing-library/react')
    cleanup()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')
  })

  it('accepts a dropped file', () => {
    const { onChange } = setup()
    const file = png('dropped.png')
    const zone = screen.getByText('Drag a file here, or choose one').closest('label') as HTMLElement
    fireEvent.drop(zone, { dataTransfer: { files: [file] } })
    expect(onChange).toHaveBeenCalledWith(file)
  })

  it('rejects a dropped file of the wrong type', () => {
    setup()
    const zone = screen.getByText('Drag a file here, or choose one').closest('label') as HTMLElement
    fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } })
    expect(screen.getByRole('alert').textContent).toContain('not supported')
  })

  it('shows a server error passed through `error`', () => {
    const { input } = setup({ error: 'Photo is not a valid image' })
    expect(input().getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toBe('Photo is not a valid image')
  })

  it('can be disabled', () => {
    const { input } = setup({ disabled: true })
    expect(input().disabled).toBe(true)
  })
})
