import type { Job } from '../../api/client'
import { Button } from '../../components/form'
import { ErrorState } from '../../components/feedback'
import { formatCredits } from './credits'
import { ProgressScreen } from './ProgressScreen'
import { ResultScreen } from './ResultScreen'
import { ReviewScreen } from './ReviewScreen'

function FailedScreen({ job, onReset }: { job: Job; onReset: () => void }) {
  const voiceFailed = !job.audio_url
  return (
    <ErrorState
      title={voiceFailed ? 'We could not make the voice' : 'We could not make this video'}
      message={`${job.error ?? 'Something went wrong on our side.'} ${job.charged_credits === 0 ? 'Nothing was charged.' : `Charged: ${formatCredits(job.charged_credits)} credits.`} Start over to try again.`}
      action={<Button onClick={onReset}>Start over</Button>}
    />
  )
}

/** One screen per job status. */
export function JobView({ job, onReset }: { job: Job; onReset: () => void }) {
  switch (job.status) {
    case 'audio_generating':
    case 'video_submitting':
    case 'video_generating':
      return <ProgressScreen status={job.status} />
    case 'audio_ready':
      return <ReviewScreen job={job} onReset={onReset} />
    case 'completed':
      return <ResultScreen job={job} onReset={onReset} />
    case 'failed':
      return <FailedScreen job={job} onReset={onReset} />
    default:
      return (
        <ErrorState
          title="Something unexpected happened"
          message="We do not recognise the state of this video. Start over to make a new one."
          action={<Button onClick={onReset}>Start over</Button>}
        />
      )
  }
}
