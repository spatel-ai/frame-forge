import { describe, expect, it } from 'vitest'
import { jobStatusHint, jobStatusLabel } from './jobStatus'

describe('job status labels', () => {
  it('R-13 names a step for each in-progress status', () => {
    expect(jobStatusLabel('video_assembling')).toBe('Adding your banners')
    expect(jobStatusLabel('audio_generating')).toBe('Making the voice')
    expect(jobStatusHint('video_generating')).toMatch(/few minutes/)
    expect(jobStatusHint('completed')).toBeUndefined()
  })
})
