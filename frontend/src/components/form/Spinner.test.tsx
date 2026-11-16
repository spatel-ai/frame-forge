import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Spinner } from './Spinner'

describe('Spinner', () => {
  it('is a status with a default accessible label', () => {
    render(<Spinner />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy()
  })

  it('takes a custom label', () => {
    render(<Spinner label="Uploading photo" size="large" />)
    expect(screen.getByRole('status', { name: 'Uploading photo' })).toBeTruthy()
  })

  it('can be decorative', () => {
    render(<Spinner decorative />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
