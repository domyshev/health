import { createTheme } from '@mui/material/styles'

// Temporary semantic defaults. Replace values after the SportApp source palette is supplied.
export function createAppTheme(mode: 'light' | 'dark') {
return createTheme({
  cssVariables: true,
  palette: {
    mode,
    primary: { main: mode === 'dark' ? '#7ee787' : '#196b37' },
    secondary: { main: mode === 'dark' ? '#79c0ff' : '#125e9e' },
    background: mode === 'dark' ? { default: '#0b1116', paper: '#111922' } : { default: '#f5f7f5', paper: '#ffffff' },
    error: { main: '#ff7b72' },
    warning: { main: '#e3b341' },
    success: { main: '#7ee787' },
    text: mode === 'dark' ? { primary: '#f0f6fc', secondary: '#9ba7b4' } : { primary: '#17221b', secondary: '#53645a' },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 760, letterSpacing: '-0.04em' },
    h2: { fontSize: 'clamp(1.5rem, 3vw, 2.25rem)', fontWeight: 720, letterSpacing: '-0.03em' },
    button: { textTransform: 'none', fontWeight: 700 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: 44 } },
    },
    MuiTextField: {
      defaultProps: { fullWidth: true },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          border: mode === 'dark' ? '1px solid rgba(240, 246, 252, 0.09)' : '1px solid rgba(20, 50, 30, 0.14)',
          backgroundImage: 'none',
        },
      },
    },
  },
})

}

export const theme = createAppTheme('dark')
