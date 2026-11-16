import type { ReactNode, SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Width and height in px. Default 20. */
  size?: number
}

function createIcon(displayName: string, shapes: ReactNode) {
  const Icon = ({ size = 20, ...rest }: IconProps) => (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {shapes}
    </svg>
  )
  Icon.displayName = displayName
  return Icon
}

export const HomeIcon = createIcon('HomeIcon', <path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />)
export const PlusCircleIcon = createIcon('PlusCircleIcon', <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>)
export const VideoIcon = createIcon('VideoIcon', <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" /></>)
export const ScriptIcon = createIcon('ScriptIcon', <><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h7M9 16h7" /></>)
export const WalletIcon = createIcon('WalletIcon', <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M16 12.5h2" /></>)
export const UserIcon = createIcon('UserIcon', <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>)
export const UploadIcon = createIcon('UploadIcon', <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />)
export const PlayIcon = createIcon('PlayIcon', <path d="M8 5l12 7-12 7z" />)
export const CheckIcon = createIcon('CheckIcon', <path d="M5 12.5l4.5 4.5L19 7.5" />)
export const AlertIcon = createIcon('AlertIcon', <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></>)
export const InfoIcon = createIcon('InfoIcon', <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5h.01" /></>)
export const CloseIcon = createIcon('CloseIcon', <path d="M6 6l12 12M18 6L6 18" />)
export const ChevronLeftIcon = createIcon('ChevronLeftIcon', <path d="M15 5l-7 7 7 7" />)
export const ChevronRightIcon = createIcon('ChevronRightIcon', <path d="M9 5l7 7-7 7" />)
export const DownloadIcon = createIcon('DownloadIcon', <path d="M12 4v12M7 11l5 5 5-5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />)
export const TrashIcon = createIcon('TrashIcon', <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />)
export const MailIcon = createIcon('MailIcon', <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>)
export const KeyIcon = createIcon('KeyIcon', <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" /></>)
export const ClockIcon = createIcon('ClockIcon', <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)
export const CoinIcon = createIcon('CoinIcon', <><circle cx="12" cy="12" r="9" /><path d="M14.5 9.5c-.5-.8-1.4-1.2-2.5-1.2-1.6 0-2.7 1.6-2.7 3.7s1.1 3.7 2.7 3.7c1.1 0 2-.4 2.5-1.2" /></>)
export const LogoutIcon = createIcon('LogoutIcon', <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9" />)
export const EyeIcon = createIcon('EyeIcon', <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>)
export const EyeOffIcon = createIcon('EyeOffIcon', <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A16 16 0 0 0 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />)
export const MenuIcon = createIcon('MenuIcon', <path d="M4 7h16M4 12h16M4 17h16" />)
export const RefreshIcon = createIcon('RefreshIcon', <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />)

export const icons = {
  HomeIcon, PlusCircleIcon, VideoIcon, ScriptIcon, WalletIcon, UserIcon, UploadIcon, PlayIcon,
  CheckIcon, AlertIcon, InfoIcon, CloseIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon,
  TrashIcon, MailIcon, KeyIcon, ClockIcon, CoinIcon, LogoutIcon, EyeIcon, EyeOffIcon, MenuIcon,
  RefreshIcon,
}
