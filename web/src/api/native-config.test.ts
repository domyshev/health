import { describe, expect, it } from 'vitest'
import { nativeAPIConfig } from './native-config'

describe('native API configuration', () => {
  it('uses the HTTPS backend origin by default', () => {
    expect(nativeAPIConfig('https://health.example', undefined)).toEqual({
      base: 'https://health.example', origin: 'https://health.example',
    })
  })

  it.each([
    undefined, 'http://health.example', 'https://user:secret@health.example',
    'https://health.example/v1', 'https://health.example?token=secret',
    'https://health.example#fragment', 'file:///tmp/api',
  ])('rejects unsafe production configuration: %s', (value) => {
    expect(() => nativeAPIConfig(value, undefined)).toThrow()
  })

  it('permits loopback HTTP only in development', () => {
    expect(nativeAPIConfig('http://127.0.0.1:8080', 'http://localhost:5173', true).base)
      .toBe('http://127.0.0.1:8080')
    expect(() => nativeAPIConfig('http://127.0.0.1:8080', undefined)).toThrow()
    expect(() => nativeAPIConfig('http://192.168.1.1', undefined, true)).toThrow()
    expect(() => nativeAPIConfig('https://health.example', 'https://other.example/path')).toThrow()
  })
})
