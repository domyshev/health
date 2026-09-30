import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GarminDrawer } from './GarminDrawer'
import { TestProviders } from '../../test/TestProviders'

afterEach(() => {
  localStorage.clear()
  vi.unstubAllGlobals()
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('Garmin connection', () => {
  it('shows the stored active status as connected', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('/v1/integrations/garmin')) {
        return json({ status: 'active', garminEmail: 'athlete@example.com' })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<GarminDrawer onClose={() => undefined} open />, { wrapper: TestProviders })

    expect(await screen.findByText(/^connected$/i)).toBeInTheDocument()
    expect(screen.getByText(/authorization completed successfully/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/garmin password/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /refresh access/i }))
    expect(screen.getByLabelText(/garmin email/i)).toHaveValue('athlete@example.com')
    expect(screen.getByLabelText(/garmin password/i)).toBeInTheDocument()
  })

  it('keeps password and MFA challenge out of persisted state', async () => {
    let connected = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('/v1/integrations/garmin')) return json({ status: connected ? 'connected' : 'not_connected' })
      if (path.endsWith('/v1/integrations/garmin/connect')) {
        return json({ status: 'mfa_required', challengeId: 'challenge-secret', expiresAt: '2026-09-21T14:00:00Z' })
      }
      if (path.includes('/challenges/challenge-secret/verify')) {
        connected = true
        return json({ status: 'connected' })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<GarminDrawer onClose={() => undefined} open />, { wrapper: TestProviders })

    await user.type(await screen.findByLabelText(/garmin email/i), 'athlete@example.com')
    await user.type(screen.getByLabelText(/garmin password/i), 'do-not-persist')
    await user.click(screen.getByRole('button', { name: /connect garmin/i }))

    const mfa = await screen.findByLabelText(/mfa code/i)
    expect(screen.queryByDisplayValue('do-not-persist')).not.toBeInTheDocument()
    expect(localStorage.getItem('health-hub:ui') ?? '').not.toContain('do-not-persist')
    expect(localStorage.getItem('health-hub:ui') ?? '').not.toContain('challenge-secret')

    await user.type(mfa, '654321')
    await user.click(screen.getByRole('button', { name: /verify mfa/i }))
    await waitFor(() => expect(screen.getByText(/connected/i)).toBeInTheDocument())
  })
})
