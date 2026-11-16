import { Link } from 'react-router'
import styles from './NotFound.module.css'

export default function NotFound() {
  return (
    <section className={styles.page}>
      <h1 className={styles.title}>Page not found</h1>
      <p className={styles.text}>The page you asked for does not exist.</p>
      <Link to="/create" className={styles.link}>Go to Create</Link>
    </section>
  )
}
