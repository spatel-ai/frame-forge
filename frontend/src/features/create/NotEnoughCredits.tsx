import { Link } from 'react-router'
import { Banner } from '../../components/feedback'
import { topUpPath } from '../../lib/returnPath'
import styles from './screens.module.css'

/** The shortfall notice. `children` carries amounts the server already worked out. "Add credits" returns to this job. */
export function NotEnoughCredits({ children, jobId }: { children: string; jobId?: string }) {
  return (
    <Banner tone="warning" title="Not enough credits" action={<Link className={styles.textLink} to={jobId ? topUpPath(jobId) : '/wallet'}>{jobId ? 'Add credits' : 'View wallet'}</Link>}>
      {children}
      {jobId && <p className={styles.note}>After paying you'll come back to this video.</p>}
    </Banner>
  )
}
