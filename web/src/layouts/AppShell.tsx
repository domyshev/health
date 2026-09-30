import { useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { Route, Routes } from 'react-router-dom'
import GarminIcon from '@mui/icons-material/WatchRounded'
import LogoutRounded from '@mui/icons-material/LogoutRounded'
import SyncRounded from '@mui/icons-material/SyncRounded'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  IconButton,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'

import {
  healthApi,
  useGetGarminConnectionQuery,
  useGetSyncRunQuery,
  useLogoutMutation,
  useStartSyncMutation,
  type User,
} from '../api/healthApi'
import { ActivitiesPage } from '../features/activities/ActivitiesPage'
import { ActivityDetailsPage } from '../features/activities/ActivityDetailsPage'
import { GarminDrawer } from '../features/garmin/GarminDrawer'
import type { AppDispatch } from '../store'
import { resetUiState } from '../store'

interface AppShellProps {
  user: User
  onLoggedOut: () => void
}

function useDocumentVisible() {
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden')
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}

export function AppShell({ user, onLoggedOut }: AppShellProps) {
  const dispatch = useDispatch<AppDispatch>()
  const completedRunRef = useRef<string | undefined>(undefined)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [syncRunId, setSyncRunId] = useState<string>()
  const [syncPending, setSyncPending] = useState(false)
  const visible = useDocumentVisible()
  const { data: connection } = useGetGarminConnectionQuery()
  const [startSync, startState] = useStartSyncMutation()
  const [logout, logoutState] = useLogoutMutation()
  const effectiveSyncRunId = syncRunId ?? connection?.activeSyncRunId
  const { data: syncRun, refetch: refetchSyncRun } = useGetSyncRunQuery(effectiveSyncRunId ?? '', {
    skip: !effectiveSyncRunId,
  })

  const syncComplete = syncRun?.status === 'succeeded' || syncRun?.status === 'complete'
  const syncPartial = syncRun?.status === 'partial'
  const syncTerminal = syncComplete || syncPartial || syncRun?.status === 'failed' || syncRun?.status === 'reconnect_required'
  const currentRunKnown = !syncRunId || syncRun?.id === syncRunId
  const active = (syncPending && (!currentRunKnown || !syncTerminal)) || startState.isLoading || (Boolean(syncRunId) && (!currentRunKnown || !syncTerminal)) || syncRun?.status === 'queued' || syncRun?.status === 'running'
  const connected = connection?.status === 'connected' || connection?.status === 'active'
  const reconnectRequired = connection?.status === 'reconnect_required' || connection?.status === 'reauth_required'

  useEffect(() => {
    if (!visible || !effectiveSyncRunId || syncTerminal) return
    const timer = window.setInterval(() => void refetchSyncRun(), 10_000)
    return () => window.clearInterval(timer)
  }, [effectiveSyncRunId, refetchSyncRun, syncTerminal, visible])

  useEffect(() => {
    if (!syncRun || !syncTerminal) return
    if (completedRunRef.current === syncRun.id) return
    completedRunRef.current = syncRun.id
    dispatch(healthApi.util.invalidateTags(['Activities', 'Garmin']))
  }, [dispatch, syncRun, syncTerminal])

  async function beginSync(mode: 'recent' | 'full_history' = 'recent') {
    if (active || !connected) return
    setSyncPending(true)
    try {
      const run = await startSync({ mode }).unwrap()
      completedRunRef.current = undefined
      setSyncRunId(run.syncRunId)
    } catch {
      setSyncPending(false)
      // Mutation state provides a safe user-facing message.
    }
  }

  async function endSession() {
    try {
      await logout().unwrap()
      dispatch(healthApi.util.resetApiState())
      dispatch(resetUiState())
      localStorage.removeItem('persist:health-hub:ui')
      onLoggedOut()
    } catch {
      // Keep the local session until the API confirms that the server session ended.
    }
  }

  const syncLabel = reconnectRequired
    ? 'Reconnect required'
    : syncComplete
      ? 'Sync complete'
      : syncPartial
        ? 'Sync partially complete'
        : syncRun?.status === 'failed'
        ? 'Sync failed'
        : syncRun?.status === 'queued'
          ? 'Sync queued'
          : active
            ? 'Syncing'
            : connection?.lastSuccessfulSyncAt
              ? `Last sync ${new Date(connection.lastSuccessfulSyncAt).toLocaleString()}`
              : 'Never synced'

  return (
    <Box sx={{ minHeight: '100dvh' }}>
      <AppBar color="transparent" elevation={0} position="sticky" sx={{ backdropFilter: 'blur(18px)', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 1.25 }}>
          <Typography sx={{ flexGrow: 1, fontWeight: 850, letterSpacing: '-0.03em' }} variant="h6">Health Hub</Typography>
          <Chip
            color={syncRun?.status === 'failed' ? 'error' : reconnectRequired || syncPartial ? 'warning' : syncComplete ? 'success' : 'default'}
            label={syncLabel}
            size="small"
            sx={{ display: { xs: 'none', md: 'inline-flex' } }}
            title={connection?.lastSuccessfulSyncAt}
          />
          <Typography color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' }, maxWidth: 170 }} noWrap variant="body2">
            {user.displayName || user.email}
          </Typography>
          <Tooltip title={connected ? 'Sync now' : 'Connect Garmin before syncing'}>
            <span>
              <IconButton aria-label="Sync now" disabled={!connected || active} onClick={() => void beginSync()}>
                <SyncRounded sx={{
                  animation: active ? 'spin 1s linear infinite' : 'none',
                  '@keyframes spin': { to: { transform: 'rotate(360deg)' } },
                  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Garmin settings">
            <IconButton aria-label="Garmin settings" onClick={() => setDrawerOpen(true)}><GarminIcon /></IconButton>
          </Tooltip>
          <Tooltip title="Log out">
            <IconButton aria-label="Log out" disabled={logoutState.isLoading} onClick={() => void endSession()}><LogoutRounded /></IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      {(startState.isError || syncRun?.status === 'failed') && (
        <Alert action={<Button onClick={() => void beginSync()}>Retry</Button>} severity="error">
          Sync failed. Existing activities remain available.
        </Alert>
      )}
      {syncRun?.status === 'reconnect_required' && (
        <Alert action={<Button onClick={() => setDrawerOpen(true)}>Refresh Garmin access</Button>} severity="warning">
          Garmin access must be refreshed before syncing can continue.
        </Alert>
      )}
      {logoutState.isError && (
        <Alert severity="error">Logout could not be completed. Your session is still active; try again.</Alert>
      )}
      <Box component="main" sx={{ mx: 'auto', maxWidth: 1180, p: { xs: 2, sm: 4 } }}>
        <Routes>
          <Route element={<ActivitiesPage />} path="/" />
          <Route element={<ActivityDetailsPage />} path="/activities/:activityId" />
          <Route element={<ActivitiesPage />} path="*" />
        </Routes>
      </Box>
      <GarminDrawer onClose={() => setDrawerOpen(false)} open={drawerOpen} />
      <Box aria-live="polite" sx={{ height: 0, overflow: 'hidden' }}>{syncLabel}</Box>
    </Box>
  )
}
