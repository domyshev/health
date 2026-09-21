import { describe, expect, it } from 'vitest'

import { createPersistedAppStore, setActivityType } from './store'

describe('persisted state', () => {
  it('stores only versioned UI preferences and never RTK Query responses', async () => {
    const { store, persistor } = createPersistedAppStore()
    if (!persistor.getState().bootstrapped) {
      await new Promise<void>((resolve) => {
        const unsubscribe = persistor.subscribe(() => {
          if (persistor.getState().bootstrapped) {
            unsubscribe()
            resolve()
          }
        })
      })
    }
    store.dispatch(setActivityType('swimming'))
    await persistor.flush()

    const persisted = localStorage.getItem('persist:health-hub:ui') ?? ''
    expect(persisted).toContain('swimming')
    expect(persisted).not.toContain('healthApi')
    expect(persisted).not.toContain('session')
    await persistor.purge()
  })
})
