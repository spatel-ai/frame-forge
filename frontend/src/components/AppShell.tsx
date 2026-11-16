import { useEffect, useState } from 'react'
import { Outlet } from 'react-router'
import { getConfig } from '../api/client'
import type { Config } from '../api/client'
import { errMsg } from '../lib/util'

const RETRY_MS = 3000

export type ShellContext = { config: Config | null; configError: string | null }

export default function AppShell() {
  const [config, setConfig] = useState<Config | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      getConfig().then(
        (c) => {
          if (!cancelled) {
            setConfig(c)
            setConfigError(null)
          }
        },
        (e) => {
          if (cancelled) return
          setConfigError(errMsg(e))
          setTimeout(load, RETRY_MS)
        },
      )
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const context: ShellContext = { config, configError }

  return (
    <main className="app">
      <header>
        <h1>Talking Avatar</h1>
        {config?.provider === 'mock' && <span className="badge">Mock mode — no real generation, no cost</span>}
      </header>

      <p className="notice">
        Internal testing only. Use only a photo of yourself, or of someone who has agreed. The output is AI-generated.
      </p>

      <Outlet context={context} />
    </main>
  )
}
