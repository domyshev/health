import { Alert, Box, Button, CircularProgress } from '@mui/material'
import { Navigate, useLocation } from 'react-router-dom'

import { useGetMeQuery } from './api/healthApi'
import { LoginPage } from './features/auth/LoginPage'
import { AppShell } from './layouts/AppShell'

export function App() {
  const { data: user, error, isLoading, refetch } = useGetMeQuery()
  const location = useLocation()

  if (isLoading) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Loading session" />
      </Box>
    )
  }

  if (user) {
    return <>{location.pathname === '/login' && <Navigate replace to="/" />}<AppShell onLoggedOut={() => window.location.assign('/login')} user={user} /></>
  }

  const status = error && 'status' in error ? error.status : undefined
  if (status !== 401) {
    return (
      <Box component="main" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2 }}>
        <Alert action={<Button onClick={() => void refetch()}>Retry</Button>} severity="error">
          Health is temporarily unavailable. Your session has not been changed.
        </Alert>
      </Box>
    )
  }

  return <>{location.pathname !== '/login' && <Navigate replace to="/login" />}<LoginPage /></>
}
