import { createTheme } from '@mui/material/styles'

// Temporary semantic defaults. Replace values after the SportApp source palette is supplied.
export const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'dark',
    primary: { main: '#7ee787' },
    secondary: { main: '#79c0ff' },
    background: { default: '#0b1116', paper: '#111922' },
    error: { main: '#ff7b72' },
    warning: { main: '#e3b341' },
    success: { main: '#7ee787' },
    text: { primary: '#f0f6fc', secondary: '#9ba7b4' },
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
          border: '1px solid rgba(240, 246, 252, 0.09)',
          backgroundImage: 'none',
        },
      },
    },
  },
})
