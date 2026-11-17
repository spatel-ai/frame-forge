import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, fetchVideoFile } from '../../api/client'
import { DownloadVideoButton } from './DownloadVideoButton'

vi.mock('../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/client')>()),
  fetchVideoFile: vi.fn(),
}))

describe('DownloadVideoButton', () => {
  afterEach(() => vi.restoreAllMocks())

  it('R-13: saves the video on the same page with a job-named file, without opening a tab', async () => {
    vi.mocked(fetchVideoFile).mockResolvedValue(new Blob(['mp4'], { type: 'video/mp4' }))
    const created = vi.fn(() => 'blob:x')
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() })
    const open = vi.spyOn(window, 'open')
    let saved: HTMLAnchorElement | null = null
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved = this })
    render(<DownloadVideoButton videoPath="/api/v1/jobs/j1/video" jobId="j1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Download video' }))
    await waitFor(() => expect(saved).not.toBeNull())
    expect(fetchVideoFile).toHaveBeenCalledWith('/api/v1/jobs/j1/video')
    expect(saved!.download).toBe('frameforge-video-j1.mp4')
    expect(saved!.href).toBe('blob:x')
    expect(open).not.toHaveBeenCalled()
  })

  it('R-13: a failed download says so and can be tried again', async () => {
    vi.mocked(fetchVideoFile).mockRejectedValue(new ApiError(410, 'This video has expired. Videos are kept for 30 days.', 'video_expired'))
    render(<DownloadVideoButton videoPath="/api/v1/jobs/j1/video" jobId="j1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Download video' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'This video has expired. Videos are kept for 30 days.')
    expect(screen.getByRole('button', { name: 'Download video' })).toBeTruthy()
  })

  it('a dropped connection shows the friendly network message, not the browser error text', async () => {
    vi.mocked(fetchVideoFile).mockRejectedValue(new TypeError('Failed to fetch'))
    render(<DownloadVideoButton videoPath="/api/v1/jobs/j1/video" jobId="j1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Download video' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'We could not download the video. Check your connection and try again.',
    )
    expect(screen.getByRole('button', { name: 'Download video' })).toBeTruthy()
  })

  it('a server error keeps its own message', async () => {
    vi.mocked(fetchVideoFile).mockRejectedValue(new ApiError(500, 'We could not download the video. Please try again.', 'download_failed'))
    render(<DownloadVideoButton videoPath="/api/v1/jobs/j1/video" jobId="j1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Download video' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'We could not download the video. Please try again.')
  })
})
