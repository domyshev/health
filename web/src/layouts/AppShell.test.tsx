import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from './AppShell'
import { TestProviders } from '../test/TestProviders'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => vi.unstubAllGlobals())

describe('protected application shell', () => {
  it('polls a manual sync to completion and performs server logout', async () => {
    let syncReads = 0
    let activityReads = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path.includes('/v1/activities')) {
        activityReads += 1
        return json({ items: [], nextCursor: '' })
      }
      if (path.endsWith('/v1/integrations/garmin')) {
        return json({ status: 'active', lastSuccessfulSyncAt: '2026-09-21T12:00:00Z' })
      }
      if (path.endsWith('/v1/sync-runs') && init?.method === 'POST') return json({ syncRunId: 'run-1', status: 'queued' }, 202)
      if (path.endsWith('/v1/sync-runs/run-1')) {
        syncReads += 1
        return json({
          id: 'run-1',
          status: syncReads > 0 ? 'complete' : 'running',
          startedAt: '2026-09-21T13:00:00Z',
          finishedAt: syncReads > 1 ? '2026-09-21T13:01:00Z' : undefined,
          discoveredCount: 1,
          importedCount: syncReads > 1 ? 1 : 0,
          updatedCount: 0,
          failedCount: 0,
        })
      }
      if (path.endsWith('/v1/auth/logout')) return new Response(null, { status: 204 })
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const onLoggedOut = vi.fn()
    const user = userEvent.setup()

    render(
      <AppShell
        onLoggedOut={onLoggedOut}
        user={{ id: 'user-1', displayName: 'Runner', email: 'runner@example.com', role: 'user' }}
      />,
      { wrapper: TestProviders },
    )

    const syncButton = await screen.findByRole('button', { name: /sync now/i })
    await waitFor(() => expect(syncButton).toBeEnabled())
    await user.click(syncButton)
    expect((await screen.findAllByText(/sync complete/i, {}, { timeout: 5000 })).length).toBeGreaterThan(0)
    await waitFor(() => expect(activityReads).toBeGreaterThan(1))
    const readsAfterCompletion = syncReads
    await new Promise((resolve) => window.setTimeout(resolve, 1200))
    expect(syncReads).toBe(readsAfterCompletion)

    await user.click(screen.getByRole('button', { name: /^menu$/i }))
    await user.click(screen.getByRole('menuitem', { name: /log out/i }))
    await waitFor(() => expect(onLoggedOut).toHaveBeenCalledOnce())
  })

  it('keeps the local session when server logout fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.includes('/v1/activities')) return json({ items: [], nextCursor: '' })
      if (path.endsWith('/v1/integrations/garmin')) return json({ status: 'not_connected' })
      if (path.endsWith('/v1/auth/logout')) {
        return json({ error: { code: 'service_unavailable', message: 'try again' } }, 503)
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const onLoggedOut = vi.fn()
    const user = userEvent.setup()

    render(
      <AppShell
        onLoggedOut={onLoggedOut}
        user={{ id: 'user-1', displayName: 'Runner', email: 'runner@example.com', role: 'user' }}
      />,
      { wrapper: TestProviders },
    )

    await user.click(await screen.findByRole('button', { name: /^menu$/i }))
    expect(screen.getByText('runner@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /about/i }))
    expect(screen.getByRole('dialog', { name: /about health/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /github.com\/domyshev\/health/i })).toHaveAttribute('href', 'https://github.com/domyshev/health')
    await user.click(screen.getByRole('button', { name: /close about/i }))
    await user.click(await screen.findByRole('button', { name: /^menu$/i }))
    await user.click(screen.getByRole('menuitem', { name: /log out/i }))

    expect(await screen.findByText(/could not be completed/i)).toBeInTheDocument()
    expect(onLoggedOut).not.toHaveBeenCalled()
  })

  it('opens an activity detail page from a card', async () => {
    const activity = {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'swimming',
      sourceType: 'open_water_swimming',
      name: 'Detailed swim',
      startedAt: '2000-01-01T12:00:00Z',
      distanceM: 100.0,
      durationS: 200.0,
      caloriesKcal: 30,
      averageHrBpm: 120,
      maxHrBpm: 140,
      swimEnvironment: 'open_water',
      averagePacePer100mS: 200.0,
      totalStrokes: 80,
      averageSwolf: 50,
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.includes('/v1/activities?')) return json({ items: [activity], nextCursor: '' })
      if (path.endsWith(`/v1/activities/${activity.id}`)) return json(activity)
      if (path.endsWith('/v1/integrations/garmin')) return json({ status: 'connected' })
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(
      <AppShell
        onLoggedOut={() => undefined}
        user={{ id: 'user-1', displayName: 'Runner', email: 'runner@example.com', role: 'user' }}
      />,
      { wrapper: TestProviders },
    )

    await user.click(await screen.findByRole('link', { name: /detailed swim/i }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Detailed swim' })).toBeInTheDocument()
    await user.hover(screen.getByRole('img', { name: 'Detailed swim' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Detailed swim')
    expect(screen.getByText('100 m')).toBeInTheDocument()
    expect(screen.getByText('120 bpm')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to activities/i })).toBeInTheDocument()
  })

  it('resumes polling an active run reported by the Garmin status endpoint', async () => {
    let syncReads = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.includes('/v1/activities')) return json({ items: [], nextCursor: '' })
      if (path.endsWith('/v1/integrations/garmin')) {
        return json({ status: 'connected', activeSyncRunId: 'active-run' })
      }
      if (path.endsWith('/v1/sync-runs/active-run')) {
        syncReads += 1
        return json({
          id: 'active-run',
          status: 'running',
          startedAt: '2026-09-21T13:00:00Z',
          discoveredCount: 0,
          importedCount: 0,
          updatedCount: 0,
          failedCount: 0,
        })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <AppShell
        onLoggedOut={() => undefined}
        user={{ id: 'user-1', displayName: 'Runner', email: 'runner@example.com', role: 'user' }}
      />,
      { wrapper: TestProviders },
    )

    expect((await screen.findAllByText(/syncing/i)).length).toBeGreaterThan(0)
    expect(syncReads).toBeGreaterThan(0)
    await userEvent.setup().click(screen.getByRole('button', { name: /garmin settings/i }))
    expect(await screen.findByText(/sync in progress: 0 discovered/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import full history/i })).toBeDisabled()
    expect(screen.queryByText(/full history import complete/i)).not.toBeInTheDocument()
  })
})
