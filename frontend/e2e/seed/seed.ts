// Seeds the e2e account and its content through the app's own API and the developer grant
// command, in mock mode. Safe to run again: it only adds what is missing.
//
//   node e2e/seed/seed.ts main   (backend polling fast: finished and failed videos)
//   node e2e/seed/seed.ts late   (backend polling effectively never: the video in progress)
//
// Both phases refuse to run unless the backend reports provider and payments in mock mode.
import { spawnSync } from 'node:child_process'
import { call, ApiFail, json, linkFromLog, login, ok, type Session } from '../support/api.ts'
import { ACCOUNT, BACKEND_DIR, BASE_URL } from '../support/env.ts'
import { makePng } from '../support/png.ts'

const phase = process.argv[2]
if (phase !== 'main' && phase !== 'late') {
  console.error('Usage: node e2e/seed/seed.ts main|late')
  process.exit(2)
}

const log = (m: string) => console.log(`[seed:${phase}] ${m}`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// One very long word, to stress wrapping, then ordinary text.
const LONG_WORD = 'Supercalifragilistic-'.repeat(5) + 'end'

async function config() {
  const c = await ok('/api/v1/config')
  if (c.provider !== 'mock' || c.payments !== 'mock') {
    throw new Error(`Refusing to seed: backend reports provider=${c.provider}, payments=${c.payments}.`)
  }
  return c
}

async function ensureSession(): Promise<Session> {
  let session = await login(ACCOUNT.email, ACCOUNT.password)
  if (session) return session
  log('signing up the test account')
  const { res, body } = await call('/api/v1/auth/signup', json(ACCOUNT))
  if (!res.ok) throw new ApiFail(res.status, body?.code ?? 'error', body?.message ?? '')
  const token = linkFromLog('verify-email')
  if (!token) throw new Error('The confirmation link is not in the backend log (E2E_BACKEND_LOG).')
  await ok('/api/v1/auth/verify-email', json({ token }))
  session = await login(ACCOUNT.email, ACCOUNT.password)
  if (!session) throw new Error('Cannot log in after sign-up.')
  return session
}

function grant(credits: number) {
  const dbUrl = process.env.E2E_DATABASE_URL
  if (!dbUrl) throw new Error('E2E_DATABASE_URL is not set.')
  const r = spawnSync('uv', ['run', 'python', '-m', 'app.wallet.cli', 'grant', ACCOUNT.email, String(credits)], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl, AVATAR_ENV: 'development', USER_EMAIL: '', USER_EMAIL_PASSWORD: '' },
    encoding: 'utf8',
  })
  if (r.status !== 0) throw new Error(`grant failed: ${r.stderr}`)
  log(r.stdout.trim())
}

async function jobsByStatus(s: Session) {
  const list = await ok('/api/v1/jobs?page_size=100', { session: s })
  return list.items as { id: string; status: string }[]
}

async function waitStatus(s: Session, id: string, want: string[], seconds = 60) {
  for (let i = 0; i < seconds; i++) {
    const job = await ok(`/api/v1/jobs/${id}`, { session: s })
    if (want.includes(job.status)) return job
    await sleep(1000)
  }
  throw new Error(`Job ${id} did not reach ${want.join('/')}.`)
}

async function createJob(s: Session, cfg: any, script: string, language: string) {
  const form = new FormData()
  form.set('image', new Blob([makePng(480, 480, [180, 120, 90])], { type: 'image/png' }), 'face.png')
  form.set('script', script)
  form.set('language', language)
  form.set('consent', 'true')
  form.set('consent_version', cfg.consent_version)
  const job = await ok('/api/v1/jobs', { method: 'POST', body: form, session: s })
  return job.id as string
}

async function approve(s: Session, id: string, bannerId: string) {
  await ok(`/api/v1/jobs/${id}/approve`, { ...json({ banner_id: bannerId }), session: s })
}

async function main() {
  const cfg = await config()
  log(`backend is in mock mode (provider=${cfg.provider}, payments=${cfg.payments}) at ${BASE_URL}`)
  const s = await ensureSession()

  if (phase === 'main') {
    const jobs = await jobsByStatus(s)
    if (jobs.length === 0) {
      // Several grants give the wallet several ledger rows.
      for (const n of [2000, 1500, 500]) grant(n)

      const scripts: [string, string][] = [
        ['English', `${LONG_WORD} A very long title, then a long body. ${'This is a long script written to test wrapping and truncation of saved scripts on every screen width. '.repeat(7)}`.slice(0, 800)],
        ['English', 'Welcome to our store. Today every item is half price until Sunday.'],
        ['Hindi', 'नमस्ते, हमारी दुकान में आपका स्वागत है। आज हर सामान आधी कीमत पर मिल रहा है।'],
        ['Punjabi', 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਸਾਡੀ ਦੁਕਾਨ ਵਿੱਚ ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ।'],
      ]
      for (const [language, text] of scripts) {
        await ok('/api/v1/scripts', { ...json({ language, text }), session: s })
      }
      log(`saved ${scripts.length} scripts`)

      const names = ['Summer sale', 'Logo card with a deliberately very long banner name 123456', 'Diwali greeting']
      const colours: [number, number, number][] = [[40, 90, 200], [200, 60, 90], [60, 160, 90]]
      const bannerIds: string[] = []
      for (let i = 0; i < names.length; i++) {
        const form = new FormData()
        form.set('name', names[i])
        form.set('image', new Blob([makePng(640, 360, colours[i])], { type: 'image/png' }), `banner${i}.png`)
        const b = await ok('/api/v1/banners', { method: 'POST', body: form, session: s })
        bannerIds.push(b.id)
      }
      log(`uploaded ${bannerIds.length} banners`)

      // Finished (two, one with a very long unbroken word in its text).
      for (const text of ['Hello everyone, this is our new offer for this week.', `${LONG_WORD} is the word of the day, said once.`.slice(0, 170)]) {
        const id = await createJob(s, cfg, text, 'English')
        await waitStatus(s, id, ['audio_ready'])
        await approve(s, id, bannerIds[0])
        await waitStatus(s, id, ['completed'], 90)
        log(`finished video ${id}`)
      }
      // Failed: the voice runs past the e2e backend's 12 second limit, so the job fails before any video.
      const failed = await createJob(s, cfg, 'This script is deliberately long so that the voice runs past the limit. '.repeat(4).slice(0, 400), 'English')
      await waitStatus(s, failed, ['failed'])
      log(`failed video ${failed}`)
      // Review: voice ready, not approved.
      const review = await createJob(s, cfg, 'Please listen to this voice and decide whether to approve it.', 'English')
      await waitStatus(s, review, ['audio_ready'])
      log(`review job ${review}`)
    } else {
      log(`already seeded (${jobs.length} videos)`)
    }
  } else {
    const jobs = await jobsByStatus(s)
    if (jobs.some((j) => j.status === 'video_generating')) {
      log('a video in progress already exists')
    } else {
      const banners = await ok('/api/v1/banners', { session: s })
      const id = await createJob(s, cfg, 'This video stays in progress for the layout checks.', 'English')
      await waitStatus(s, id, ['audio_ready'])
      await approve(s, id, banners.items[0].id)
      const job = await waitStatus(s, id, ['video_generating', 'video_submitting'])
      log(`video in progress ${id} (${job.status})`)
    }
  }
  const all = await jobsByStatus(s)
  const counts: Record<string, number> = {}
  for (const j of all) counts[j.status] = (counts[j.status] ?? 0) + 1
  log(`videos by status: ${JSON.stringify(counts)}`)
}

main().catch((e) => {
  console.error(`[seed:${phase}] FAILED: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
