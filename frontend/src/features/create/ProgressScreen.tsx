import type { Job } from '../../api/client'
import { ProgressSteps } from '../../components/feedback'
import type { ProgressStep } from '../../components/feedback'
import { Card } from '../../components/layout'
import styles from './screens.module.css'

type InProgress = Extract<Job['status'], 'audio_generating' | 'video_submitting' | 'video_generating'>

function stepsFor(status: InProgress): { title: string; steps: ProgressStep[] } {
  if (status === 'audio_generating') {
    return {
      title: 'Making the voice',
      steps: [
        { label: 'Making the voice', state: 'current', hint: 'Turning your script into speech.' },
        { label: 'Listen and approve', state: 'upcoming', hint: 'You will hear it before any video is made.' },
      ],
    }
  }
  const sending = status === 'video_submitting'
  return {
    title: 'Making your video',
    steps: [
      { label: 'Voice ready', state: 'done', hint: 'You approved the voice.' },
      {
        label: 'Sending to the video model',
        state: sending ? 'current' : 'done',
        hint: sending ? 'Sending your photo and voice.' : 'Your photo and voice have been sent.',
      },
      {
        label: 'Making the video',
        state: sending ? 'upcoming' : 'current',
        hint: sending ? 'Waiting to start.' : 'This can take several minutes.',
      },
    ],
  }
}

export function ProgressScreen({ status }: { status: InProgress }) {
  const { title, steps } = stepsFor(status)
  return (
    <div className={styles.centered}>
      <Card padding="lg">
        <section className={styles.cardBody} aria-labelledby="h-progress">
          <h2 id="h-progress" className={styles.heading}>{title}</h2>
          <ProgressSteps steps={steps} />
          <p className={styles.note}>
            This can take several minutes. It is safe to leave or reload this page: we keep working and
            this page picks up where it left off.
          </p>
        </section>
      </Card>
    </div>
  )
}
