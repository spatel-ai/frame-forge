import { useOutletContext } from 'react-router'
import type { Job } from '../../api/client'
import type { ShellContext } from '../../components/AppShell'
import { ProgressSteps } from '../../components/feedback'
import type { ProgressStep } from '../../components/feedback'
import { Card } from '../../components/layout'
import styles from './screens.module.css'

type InProgress = Extract<Job['status'], 'audio_generating' | 'video_submitting' | 'video_generating' | 'video_assembling'>

function stepsFor(status: InProgress, withBanners: boolean): { title: string; steps: ProgressStep[] } {
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
  const assembling = status === 'video_assembling'
  const steps: ProgressStep[] = [
    { label: 'Voice ready', state: 'done', hint: 'You approved the voice.' },
    {
      label: 'Sending to the video model',
      state: sending ? 'current' : 'done',
      hint: sending ? 'Sending your photo and voice.' : 'Your photo and voice have been sent.',
    },
    {
      label: 'Making the video',
      state: sending ? 'upcoming' : assembling ? 'done' : 'current',
      hint: sending ? 'Waiting to start.' : assembling ? 'Your talking video is ready.' : 'This can take several minutes.',
    },
  ]
  if (withBanners) {
    steps.push({
      label: 'Adding your banners',
      state: assembling ? 'current' : 'upcoming',
      hint: 'Joining your start and end banners to the video. Banners are free.',
    })
  }
  return { title: 'Making your video', steps }
}

export function ProgressScreen({ status }: { status: InProgress }) {
  const { config } = useOutletContext<ShellContext>()
  // The banner step is shown when banners are on, and always while the server is adding them.
  const { title, steps } = stepsFor(status, config?.banners_enabled === true || status === 'video_assembling')
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
