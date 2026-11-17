import type { JobSummary } from '../api/client'

type Status = JobSummary['status']

/** Step name a customer sees for a job that is still being made. */
const LABELS: Record<Status, string> = {
  audio_generating: 'Making the voice',
  audio_ready: 'Listen and approve',
  video_submitting: 'Starting the video',
  video_generating: 'Generating the video',
  video_assembling: 'Adding your banners',
  completed: 'Ready',
  failed: 'Failed',
}

const HINTS: Partial<Record<Status, string>> = {
  audio_generating: 'The voice takes a few seconds.',
  audio_ready: 'Your voice is ready. Listen to it, then decide whether to make the video.',
  video_submitting: 'Sending your photo and voice to be made into a video.',
  video_generating: 'This usually takes a few minutes; you can leave this page.',
  video_assembling: 'Almost done. Adding the banners you chose.',
}

export const jobStatusLabel = (status: Status): string => LABELS[status]
export const jobStatusHint = (status: Status): string | undefined => HINTS[status]
