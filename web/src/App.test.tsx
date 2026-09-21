import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { TestProviders } from './test/TestProviders'

afterEach(() => vi.unstubAllGlobals())

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('passwordless authentication', () => {
  it('requests a code, verifies it, and opens the protected dashboard', async () => {
    let signedIn = false
    let meReads = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      if (path.endsWith('/v1/me') && !init?.method) {
        meReads += 1
        return signedIn
          ? json({ id: 'user-1', email: 'runner@example.com', displayName: 'Runner', role: 'user' })
          : json({ error: { code: 'unauthorized' } }, 401)
      }
      if (path.endsWith('/v1/auth/request-code')) return json({ status: 'accepted' }, 202)
      if (path.endsWith('/v1/auth/verify-code')) {
        signedIn = true
        return json({ id: 'user-1', email: 'runner@example.com', displayName: 'Runner', role: 'user' })
      }
      if (path.includes('/v1/activities')) return json({ items: [], nextCursor: '' })
      if (path.endsWith('/v1/garmin/connection')) return json({ status: 'not_connected' })
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<App />, { wrapper: TestProviders })

    await user.type(await screen.findByLabelText(/email/i), 'runner@example.com')
    await user.click(screen.getByRole('button', { name: /send code/i }))
    expect(await screen.findByRole('button', { name: /resend in/i })).toBeDisabled()
    await user.type(await screen.findByLabelText(/verification code/i), '123456')
    await user.click(screen.getByRole('button', { name: /verify/i }))

    expect(await screen.findByRole('heading', { name: /activities/i })).toBeInTheDocument()
    expect(meReads).toBeGreaterThan(1)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/v1/auth/verify-code',
        expect.objectContaining({ credentials: 'include', method: 'POST' }),
      )
    })
  })
})
