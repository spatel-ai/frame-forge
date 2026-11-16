import type { Job } from '../../api/client'

/** The three steps of the create flow in M1.5. Banners (M5) and price (M3) add steps later. */
export const STEPS = [{ label: 'Details' }, { label: 'Review' }, { label: 'Video' }]

export const STEP_DETAILS = 1
export const STEP_REVIEW = 2
export const STEP_VIDEO = 3

/** Which step a job belongs to, counting from 1. */
export function stepForJob(job: Job): number {
  switch (job.status) {
    case 'audio_generating':
    case 'audio_ready':
      return STEP_REVIEW
    case 'failed':
      // No audio yet means the voice itself failed; otherwise the failure came after approval.
      return job.audio_url ? STEP_VIDEO : STEP_REVIEW
    default:
      return STEP_VIDEO
  }
}
