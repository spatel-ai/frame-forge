import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs without globals, so Testing Library does not clean up after each test by itself.
afterEach(() => {
  cleanup()
})

// jsdom does not implement object URLs; the photo preview calls these.
URL.createObjectURL = () => 'blob:test-preview'
URL.revokeObjectURL = () => {}
