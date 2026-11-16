import type { CSSProperties, ReactNode } from 'react'
import styles from './Skeleton.module.css'

export interface SkeletonProps {
  shape?: 'block' | 'line' | 'circle'
  /** CSS width (number = px). Lines default to 100%, circles to 40px. */
  width?: number | string
  /** CSS height (number = px). */
  height?: number | string
}

/** Decorative placeholder. Wrap a group in SkeletonGroup to give screen readers a label. */
export function Skeleton({ shape = 'block', width, height }: SkeletonProps) {
  const style: CSSProperties = { width, height }
  if (shape === 'circle') {
    style.width = width ?? 40
    style.height = height ?? style.width
  }
  return <span aria-hidden="true" className={`${styles.skeleton} ${styles[shape]}`} style={style} />
}

export interface SkeletonGroupProps {
  /** Announced to screen readers, for example "Loading videos". */
  label: string
  children: ReactNode
}

export function SkeletonGroup({ label, children }: SkeletonGroupProps) {
  return (
    <div role="status" aria-busy="true" className={styles.group}>
      <span className={styles.srOnly}>{label}</span>
      {children}
    </div>
  )
}
