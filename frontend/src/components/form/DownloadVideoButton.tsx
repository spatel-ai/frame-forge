import { useState } from 'react'
import { ApiError, fetchVideoFile } from '../../api/client'
import { DownloadIcon } from '../icons'
import { Button } from './Button'

/** "Download video": saves the file on the same page (no new tab), named after the job. */
export function DownloadVideoButton({ videoPath, jobId }: { videoPath: string; jobId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = await fetchVideoFile(videoPath)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `frameforge-video-${jobId}.mp4`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'We could not download the video. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button size="large" busy={busy} busyLabel="Downloading…" onClick={() => void download()}>
        <DownloadIcon size={18} />
        Download video
      </Button>
      {/* Full-width flex item: wraps within the column even where the page's action row does not shrink its children. */}
      {error && <p role="alert" style={{ flex: '1 1 100%', minWidth: 0 }}>{error}</p>}
    </>
  )
}
