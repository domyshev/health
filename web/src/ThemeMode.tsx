import { createContext, useContext, useMemo, useState, type PropsWithChildren } from 'react'
import { ThemeProvider, useMediaQuery } from '@mui/material'
import { createAppTheme } from './theme'

type Mode = 'light' | 'system' | 'dark'
const ThemeModeContext = createContext<{ mode: Mode; setMode: (mode: Mode) => void }>({ mode: 'dark', setMode: () => undefined })
export const useThemeMode = () => useContext(ThemeModeContext)

export function ThemeModeProvider({ children }: PropsWithChildren) {
  const [mode, setModeState] = useState<Mode>(() => {
    const stored = localStorage.getItem('health:theme')
    return stored === 'light' || stored === 'system' || stored === 'dark' ? stored : 'dark'
  })
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)')
  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
  const theme = useMemo(() => createAppTheme(resolved), [resolved])
  function setMode(next: Mode) {
    localStorage.setItem('health:theme', next)
    setModeState(next)
  }
  return <ThemeModeContext.Provider value={{ mode, setMode }}><ThemeProvider theme={theme}>{children}</ThemeProvider></ThemeModeContext.Provider>
}
