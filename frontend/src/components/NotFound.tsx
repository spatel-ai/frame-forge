import { Link } from 'react-router'

export default function NotFound() {
  return (
    <p className="muted">
      Page not found. <Link to="/create">Go to Create</Link>
    </p>
  )
}
