// The device matrix of docs/M3.5-PLAN.md, in one place. Each entry runs in Chromium and WebKit.
// Heights are typical for the device; the width is what the layout rules depend on.
export type Device = {
  /** Used in project names, screenshot folders and `--project` filters. */
  id: string
  width: number
  height: number
  note: string
}

export const DEVICES: Device[] = [
  { id: '320', width: 320, height: 568, note: 'small phone' },
  { id: '360', width: 360, height: 740, note: 'small phone (common Android)' },
  { id: '390', width: 390, height: 844, note: 'phone (iPhone)' },
  { id: '430', width: 430, height: 932, note: 'large phone' },
  { id: '667x375', width: 667, height: 375, note: 'phone held sideways' },
  { id: '844x390', width: 844, height: 390, note: 'phone held sideways' },
  { id: '768', width: 768, height: 1024, note: 'tablet upright' },
  { id: '820', width: 820, height: 1180, note: 'tablet upright' },
  { id: '1024', width: 1024, height: 768, note: 'tablet sideways / small laptop' },
  { id: '1180x820', width: 1180, height: 820, note: 'tablet held sideways' },
  { id: '1280', width: 1280, height: 800, note: 'laptop' },
  { id: '1440', width: 1440, height: 900, note: 'desktop' },
  { id: '1920', width: 1920, height: 1080, note: 'large desktop' },
]

export const ENGINES = ['chromium', 'webkit'] as const
export type Engine = (typeof ENGINES)[number]

/** Phone rules (16 px inputs, bottom bar) apply below this width. */
export const PHONE_BELOW = 768
