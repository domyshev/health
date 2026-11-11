import { afterEach, describe, expect, it, vi } from 'vitest'

import { Capacitor, CapacitorHttp } from '@capacitor/core'

import { ApiError, apiRequest } from './client'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
  CapacitorHttp: { request: vi.fn() },
}))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.clearAllMocks()
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


describe('native API transport', () => {
  function setup() {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    vi.stubEnv('VITE_NATIVE_API_URL', 'https://health.example')
    vi.stubEnv('VITE_NATIVE_REQUEST_ORIGIN', 'https://web.example')
    return vi.spyOn(CapacitorHttp, 'request')
  }

  it('uses native HTTP with the configured origin and JSON body', async () => {
    const request = setup().mockResolvedValue({ status: 200, data: { id: 'user' }, headers: {}, url: '' })
    expect(await apiRequest('/v1/auth/verify-code', {
      method: 'POST', body: JSON.stringify({ email: 'runner@example.com', code: '123456' }),
    })).toEqual({ id: 'user' })
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://health.example/v1/auth/verify-code', method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'https://web.example' },
      data: { email: 'runner@example.com', code: '123456' }, disableRedirects: true,
    }))
  })

  it('preserves API errors and empty logout responses', async () => {
    const request = setup().mockResolvedValue({ status: 401,
      data: { error: { code: 'unauthorized', message: 'Sign in' } }, headers: {}, url: '' })
    await expect(apiRequest('/v1/me')).rejects.toEqual(new ApiError(401, 'unauthorized', 'Sign in'))
    request.mockResolvedValue({ status: 204, data: '', headers: {}, url: '' })
    expect(await apiRequest('/v1/auth/logout', { method: 'POST' })).toBeUndefined()
  })

  it('does not forward sensitive requests to another host', async () => {
    const request = setup()
    await expect(apiRequest('https://other.example/v1/me')).rejects.toThrow()
    await expect(apiRequest('//other.example/v1/me')).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('discards responses canceled while native HTTP was running', async () => {
    const controller = new AbortController()
    setup().mockImplementation(async () => {
      controller.abort()
      return { status: 200, data: { id: 'stale-user' }, headers: {}, url: '' }
    })
    await expect(apiRequest('/v1/me', { signal: controller.signal })).rejects.toThrow('Aborted')
  })
})
