import type { PropsWithChildren } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { CssBaseline, ThemeProvider } from '@mui/material'

import { createAppStore } from '../store'
import { theme } from '../theme'

export function TestProviders({ children }: PropsWithChildren) {
  return (
    <Provider store={createAppStore()}>
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </ThemeProvider>
      </MemoryRouter>
    </Provider>
  )
}
