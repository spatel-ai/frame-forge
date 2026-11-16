import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs without globals, so Testing Library does not clean up after each test by itself.
afterEach(() => {
  cleanup()
})

// jsdom lacks HTMLDialogElement.showModal/close (verified in M1.5 Phase 0). Minimal stand-in, only when missing.
// Real modal behaviour (focus trap, top layer) is covered by the browser review, not by jsdom.
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  }
}

// jsdom does not implement object URLs; the photo preview calls these.
URL.createObjectURL = () => 'blob:test-preview'
URL.revokeObjectURL = () => {}
