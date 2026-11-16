// Decorative artwork for the auth split screen. Colours come from tokens only; all of it is aria-hidden.

export function BrandBackdrop() {
  return (
    <svg aria-hidden="true" viewBox="0 0 720 960" preserveAspectRatio="xMidYMid slice">
      <circle cx="640" cy="90" r="220" fill="var(--color-surface)" opacity="0.07" />
      <circle cx="640" cy="90" r="130" fill="var(--color-surface)" opacity="0.07" />
      <circle cx="40" cy="900" r="260" fill="var(--color-ink)" opacity="0.14" />
      <circle cx="360" cy="430" r="250" fill="none" stroke="var(--color-surface)" strokeWidth="1.5" strokeDasharray="2 12" strokeLinecap="round" opacity="0.45" />
      <circle cx="360" cy="430" r="320" fill="none" stroke="var(--color-surface)" strokeWidth="1.5" opacity="0.12" />
      <path d="M0 700c120-60 220 40 360-10s220-110 360-50" fill="none" stroke="var(--color-surface)" strokeWidth="2" opacity="0.18" />
      <path d="M0 740c120-60 220 40 360-10s220-110 360-50" fill="none" stroke="var(--color-surface)" strokeWidth="2" opacity="0.1" />
    </svg>
  )
}

export function CardBackdrop() {
  return (
    <svg aria-hidden="true" viewBox="0 0 720 960" preserveAspectRatio="xMidYMid slice">
      <circle cx="690" cy="60" r="180" fill="var(--color-primary-soft)" />
      <circle cx="20" cy="930" r="200" fill="var(--color-primary-soft)" />
      <circle cx="690" cy="60" r="250" fill="none" stroke="var(--color-line)" strokeWidth="1.5" />
      <circle cx="20" cy="930" r="270" fill="none" stroke="var(--color-line)" strokeWidth="1.5" strokeDasharray="2 12" strokeLinecap="round" />
      <path d="M96 150l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill="var(--color-primary)" opacity="0.35" />
      <path d="M630 800l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill="var(--color-primary)" opacity="0.35" />
    </svg>
  )
}

/** Script card, video card with waveform bubble, and (optionally) the credit chip. */
export function BrandIllustration({ credit = true }: { credit?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 460 340">
      <g transform="rotate(-6 104 236)">
        <rect x="20" y="176" width="168" height="120" rx="14" fill="var(--color-surface)" />
        <rect x="38" y="196" width="72" height="10" rx="5" fill="var(--color-primary)" />
        <rect x="38" y="218" width="132" height="8" rx="4" fill="var(--color-line)" />
        <rect x="38" y="234" width="120" height="8" rx="4" fill="var(--color-line)" />
        <rect x="38" y="250" width="132" height="8" rx="4" fill="var(--color-line)" />
        <rect x="38" y="266" width="84" height="8" rx="4" fill="var(--color-line)" />
      </g>
      <g transform="rotate(3 285 165)">
        <rect x="154" y="54" width="270" height="230" rx="18" fill="var(--color-ink)" opacity="0.18" />
        <rect x="150" y="46" width="270" height="230" rx="18" fill="var(--color-surface)" />
        <rect x="166" y="62" width="238" height="150" rx="12" fill="var(--color-primary-soft)" />
        <circle cx="285" cy="118" r="30" fill="var(--color-primary)" />
        <path d="M225 212c0-34 26-56 60-56s60 22 60 56z" fill="var(--color-primary)" />
        <circle cx="190" cy="244" r="16" fill="var(--color-primary)" />
        <path d="M185 236l13 8-13 8z" fill="var(--color-surface)" />
        <rect x="218" y="240" width="186" height="8" rx="4" fill="var(--color-line)" />
        <rect x="218" y="240" width="78" height="8" rx="4" fill="var(--color-primary)" />
      </g>
      <path d="M336 8h96a16 16 0 0 1 16 16v44a16 16 0 0 1-16 16h-58l-22 20V84h-16a16 16 0 0 1-16-16V24a16 16 0 0 1 16-16z" fill="var(--color-ink)" />
      <rect x="342" y="39" width="6" height="14" rx="3" fill="var(--color-surface)" />
      <rect x="356" y="31" width="6" height="30" rx="3" fill="var(--color-surface)" />
      <rect x="370" y="24" width="6" height="44" rx="3" fill="var(--color-surface)" />
      <rect x="384" y="34" width="6" height="24" rx="3" fill="var(--color-surface)" />
      <rect x="398" y="27" width="6" height="38" rx="3" fill="var(--color-surface)" />
      <rect x="412" y="37" width="6" height="18" rx="3" fill="var(--color-surface)" />
      <rect x="426" y="41" width="6" height="10" rx="3" fill="var(--color-surface)" />
      {credit && (
        <>
          <rect x="24" y="70" width="124" height="44" rx="22" fill="var(--color-surface)" />
          <circle cx="48" cy="92" r="13" fill="var(--color-credit)" />
          <circle cx="48" cy="92" r="6.5" fill="none" stroke="var(--color-warning)" strokeWidth="2" />
          <rect x="72" y="86" width="58" height="12" rx="6" fill="var(--color-ink)" />
        </>
      )}
      <path d="M214 14l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill="var(--color-surface)" />
      <path d="M436 300l2.5 7 7 2.5-7 2.5-2.5 7-2.5-7-7-2.5 7-2.5z" fill="var(--color-surface)" opacity="0.8" />
      <path d="M112 148l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="var(--color-surface)" opacity="0.7" />
    </svg>
  )
}
