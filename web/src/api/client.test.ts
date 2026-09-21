import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiRequest } from './client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiRequest', () => {
  it('sends same-origin session cookies without storing credentials in JavaScript', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'user-1', email: 'runner@example.com', role: 'user' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest('/v1/me')

    expect(fetchMock).toHaveBeenCalledWith(
      '/v1/me',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('maps stable API error codes into a typed error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'sign in required' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    await expect(apiRequest('/v1/me')).rejects.toEqual(
      new ApiError(401, 'unauthorized', 'sign in required'),
    )
  })
})
