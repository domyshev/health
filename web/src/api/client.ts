import { Capacitor, CapacitorHttp } from '@capacitor/core'

import { nativeAPIConfig } from './native-config'

export interface ApiErrorBody {
  error?: {
    code?: string
    message?: string
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (Capacitor.isNativePlatform()) {
    const config = nativeAPIConfig(
      import.meta.env.VITE_NATIVE_API_URL,
      import.meta.env.VITE_NATIVE_REQUEST_ORIGIN,
      import.meta.env.MODE === 'native-development',
    )
    if (init.body !== undefined && typeof init.body !== 'string') {
      throw new Error('Native API requests require a JSON string body.')
    }
    const url = new URL(path, config.base)
    if (url.origin !== config.base || !url.pathname.startsWith('/v1/')) {
      throw new Error('Native requests must target the configured Health Hub API.')
    }
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    // URLSession owns session cookies; never copy authentication data to browser storage.
    const response = await CapacitorHttp.request({
      url: url.href,
      method: init.method ?? 'GET',
      headers: { ...Object.fromEntries(headers.entries()), Origin: config.origin },
      data: init.body === undefined ? undefined : JSON.parse(init.body) as unknown,
      responseType: 'json',
      connectTimeout: 15_000,
      readTimeout: 60_000,
      disableRedirects: true,
    })
    // Native requests cannot be canceled after dispatch, so discard canceled results.
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (response.status < 200 || response.status >= 300) {
      const body = response.data as ApiErrorBody | undefined
      throw new ApiError(response.status, body?.error?.code ?? 'request_failed',
        body?.error?.message ?? `Request failed with status ${response.status}`)
    }
    return (response.status === 204 ? undefined : response.data) as T
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (!response.ok) {
    const body = await readJson<ApiErrorBody>(response)
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'request_failed',
      body?.error?.message ?? `Request failed with status ${response.status}`,
    )
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

async function readJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T
  } catch {
    return undefined
  }
}
