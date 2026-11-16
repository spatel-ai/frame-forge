import type { ComponentType } from 'react'
import { AlertIcon, CheckIcon, InfoIcon, type IconProps } from '../icons'

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** Every tone has an icon, so state is never carried by colour alone. */
export const toneIcons: Record<Tone, ComponentType<IconProps>> = {
  neutral: InfoIcon,
  info: InfoIcon,
  success: CheckIcon,
  warning: AlertIcon,
  danger: AlertIcon,
}
