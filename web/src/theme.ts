import { createTheme } from '@mui/material/styles'

export function createAppTheme(mode: 'light' | 'dark') {
return createTheme({
  cssVariables: true,
  palette: {
    mode,
    primary: { main: mode === 'dark' ? '#ef4444' : '#b91c1c' },
    secondary: { main: mode === 'dark' ? '#eeeeee' : '#252525' },
    background: mode === 'dark' ? { default: '#101010', paper: '#1b1b1b' } : { default: '#f4f4f4', paper: '#ffffff' },
    error: { main: '#dc2626' },
    warning: { main: '#b45309' },
    success: { main: '#888888' },
    text: mode === 'dark' ? { primary: '#f5f5f5', secondary: '#aaaaaa' } : { primary: '#161616', secondary: '#666666' },
  },
  shape: { borderRadius: 14 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 760, letterSpacing: '-0.04em' },
    h2: { fontSize: 'clamp(1.5rem, 3vw, 2.25rem)', fontWeight: 720, letterSpacing: '-0.03em' },
    button: { textTransform: 'none', fontWeight: 700 },
  },
  components: {
    MuiCssBaseline: { styleOverrides: { img: { filter: 'grayscale(100%)' } } },
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
          border: mode === 'dark' ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(0, 0, 0, 0.12)',
          backgroundImage: 'none',
        },
      },
    },
  },
})

}

export const theme = createAppTheme('dark')
