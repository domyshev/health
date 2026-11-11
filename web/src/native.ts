import { Capacitor } from '@capacitor/core'

export function initializeNative() {
  if (!Capacitor.isNativePlatform()) return
  document.documentElement.dataset.platform = Capacitor.getPlatform()
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return
    const link = event.target.closest<HTMLAnchorElement>('a[href]')
    if (!link) return
    const url = new URL(link.href)
    if (!['https:', 'http:'].includes(url.protocol) || url.origin === window.location.origin) return
    event.preventDefault()
    void import('@capacitor/browser').then(({ Browser }) => Browser.open({ url: url.href }))
      .catch(() => console.error('Unable to open external link'))
  })
}
