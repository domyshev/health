import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'
import { BrowserRouter } from 'react-router-dom'
import { CssBaseline } from '@mui/material'

import { App } from './App'
import { initializeNative } from './native'
import './native.css'
import { persistor, store } from './store'
import { ThemeModeProvider } from './ThemeMode'

initializeNative()

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

createRoot(root).render(
  <StrictMode>
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <BrowserRouter>
          <ThemeModeProvider>
            <CssBaseline />
            <App />
          </ThemeModeProvider>
        </BrowserRouter>
      </PersistGate>
    </Provider>
  </StrictMode>,
)
