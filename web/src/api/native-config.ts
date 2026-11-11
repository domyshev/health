export function nativeAPIConfig(base: unknown, origin: unknown, development = false) {
  if (typeof base !== 'string' || !base) throw new Error('Prepare the iPhone build with VITE_NATIVE_API_URL.')
  function parse(value: string) {
    const url = new URL(value)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(development && loopback && url.protocol === 'http:'))) {
      throw new Error('Native API configuration requires a clean HTTPS origin; development permits loopback HTTP only.')
    }
    return url.origin
  }
  return { base: parse(base), origin: parse(typeof origin === 'string' && origin ? origin : base) }
}
