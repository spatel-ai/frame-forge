import { Link } from 'react-router'
import { Banner } from '../../components/feedback'
import styles from './screens.module.css'

/** The shortfall notice. `children` carries amounts the server already worked out. */
export function NotEnoughCredits({ children }: { children: string }) {
  return (
    <Banner tone="warning" title="Not enough credits" action={<Link className={styles.textLink} to="/wallet">View wallet</Link>}>
      {children}
    </Banner>
  )
}
