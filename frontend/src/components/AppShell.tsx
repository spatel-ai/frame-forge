import { useQuery } from '@tanstack/react-query'
import { Outlet } from 'react-router'
import { getConfig } from '../api/client'
import type { Config } from '../api/client'
import { errMsg } from '../lib/util'

const RETRY_MS = 3000

export type ShellContext = { config: Config | null; configError: string | null }

export default function AppShell() {
  const query = useQuery({
    queryKey: ['config'],
    queryFn: getConfig,
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // While the configuration has not loaded, try again every few seconds.
    refetchInterval: (q) => (q.state.data ? false : RETRY_MS),
    refetchIntervalInBackground: true,
  })
  const config = query.data ?? null
  const configError = query.error && !config ? errMsg(query.error) : null

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
