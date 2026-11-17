import { useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { Route, Routes, useLocation } from 'react-router-dom'
import GarminIcon from '@mui/icons-material/WatchRounded'
import LogoutRounded from '@mui/icons-material/LogoutRounded'
import MenuRounded from '@mui/icons-material/MenuRounded'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import CloseRounded from '@mui/icons-material/CloseRounded'
import LightModeRounded from '@mui/icons-material/LightModeRounded'
import DarkModeRounded from '@mui/icons-material/DarkModeRounded'
import BrightnessAutoRounded from '@mui/icons-material/BrightnessAutoRounded'
import SyncRounded from '@mui/icons-material/SyncRounded'
import QueryStatsRounded from '@mui/icons-material/QueryStatsRounded'
import FavoriteBorderRounded from '@mui/icons-material/FavoriteBorderRounded'
import { Help } from '../features/help/Help'
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Link,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
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
import { version } from '../../package.json'
import { useThemeMode } from '../ThemeMode'
import { HealthLogo } from '../components/HealthLogo'

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
  const { pathname } = useLocation()
  const [deployedAt, setDeployedAt] = useState<string>()
  const { mode, setMode } = useThemeMode()
  const completedRunRef = useRef<string | undefined>(undefined)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [helpStatisticsOpen, setHelpStatisticsOpen] = useState(false)
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

  useEffect(() => {
    if (!aboutOpen) return
    const controller = new AbortController()
    async function loadDeploymentTime() {
      try {
        const deployment = await fetch('/deployment.json', { signal: controller.signal }).then((response) => response.json()) as { commit?: string }
        if (!deployment.commit) return
        const refs = await fetch('https://api.github.com/repos/domyshev/health/git/matching-refs/tags/deploy-web-', { signal: controller.signal }).then((response) => response.json()) as { ref: string; object: { sha: string } }[]
        if (!Array.isArray(refs)) return
        const tag = refs.filter((ref) => ref.object.sha === deployment.commit).map((ref) => ref.ref).sort().at(-1)
        const match = tag?.match(/deploy-web-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/)
        if (match) setDeployedAt(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`)
      } catch {
        // Deployment metadata may be unavailable in development or offline.
      }
    }
    void loadDeploymentTime()
    return () => controller.abort()
  }, [aboutOpen])

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

  const lastSyncedAt = syncComplete && currentRunKnown && syncRun?.finishedAt
    ? syncRun.finishedAt
    : connection?.lastSuccessfulSyncAt
  const syncedDate = lastSyncedAt ? new Date(lastSyncedAt) : undefined
  const syncedTime = syncedDate ? `${syncedDate.toLocaleString()} ${new Intl.DateTimeFormat('en-GB', {
    timeZoneName: 'short',
  }).formatToParts(syncedDate).find((part) => part.type === 'timeZoneName')?.value ?? ''}`.trim() : undefined
  const syncLabel = reconnectRequired
    ? 'Reconnect required'
    : syncPartial
        ? 'Sync partially complete'
        : syncRun?.status === 'failed'
        ? 'Sync failed'
        : syncRun?.status === 'queued'
          ? 'Sync queued'
          : active
            ? 'Syncing'
            : syncedTime
              ? `Synced: ${syncedTime}`
              : 'Never synced'

  return (
    <Box sx={{ minHeight: '100dvh' }}>
      <AppBar color="transparent" elevation={0} position="sticky" sx={{ backdropFilter: 'blur(18px)', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Toolbar sx={{ gap: { xs: 0, sm: 1.25 }, px: { xs: 1, sm: 3 }, position: 'relative', '& .header-action': { color: 'text.secondary', p: { xs: 0.25, sm: 1 }, '& svg': { fontSize: 20 } } }}>
          <Stack direction="row" spacing={1} sx={{ flexGrow: 1, alignItems: 'center' }}>
            <HealthLogo />
            <Typography sx={{ display: { xs: 'none', sm: 'block' }, fontWeight: 850, letterSpacing: '-0.03em' }} variant="h6">Health</Typography>
          </Stack>
          {(pathname === '/' || !pathname.startsWith('/activities/')) && <Box component="nav" aria-label="Breadcrumb" sx={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 0.5, fontSize: '1rem', fontWeight: 760, letterSpacing: '-0.04em', whiteSpace: 'nowrap' }}>
            <FavoriteBorderRounded titleAccess="Home" sx={{ fontSize: 'calc(1em + 8px)', color: 'primary.main', '@keyframes heart-pulse': { '0%, 9%, 18%, 33%, 42%, 51%, 66%, 75%, 84%, 93%, 100%': { transform: 'scale(1)' }, '4%, 13%, 22%, 37%, 46%, 55%, 70%, 79%, 88%, 97%': { transform: 'scale(1.22)' } }, '&:hover': { animation: 'heart-pulse 2.8s ease-in-out infinite' }, '@media (prefers-reduced-motion: reduce)': { '&:hover': { animation: 'none' } } }} />
            <Box component="span" aria-hidden="true">»</Box>
            <Typography component="h1" aria-current="page" sx={{ fontSize: 'inherit', fontWeight: 'inherit', letterSpacing: 'inherit' }}>Activities</Typography>
          </Box>}
          <Chip
            color={syncRun?.status === 'failed' ? 'error' : reconnectRequired || syncPartial ? 'warning' : 'default'}
            label={syncLabel}
            size="small"
            sx={{ display: { xs: 'none', lg: 'inline-flex' }, ...(syncLabel.startsWith('Synced:') ? { bgcolor: mode === 'dark' ? 'rgba(211, 169, 78, 0.16)' : 'rgba(211, 169, 78, 0.18)' } : {}) }}
            title={lastSyncedAt}
          />
          <Tooltip title={connected ? 'Sync now' : 'Connect Garmin before syncing'}>
            <span>
              <IconButton className="header-action" aria-label="Sync now" disabled={!connected || active} onClick={() => void beginSync()}>
                <SyncRounded sx={{
                  animation: active ? 'spin 1s linear infinite' : 'none',
                  '@keyframes spin': { to: { transform: 'rotate(360deg)' } },
                  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                }} />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Help statistics">
            <IconButton className="header-action" aria-label="Help statistics" onClick={() => setHelpStatisticsOpen(true)}><QueryStatsRounded /></IconButton>
          </Tooltip>
          <Tooltip title="Garmin settings">
            <IconButton className="header-action" aria-label="Garmin settings" onClick={() => setDrawerOpen(true)}><GarminIcon /></IconButton>
          </Tooltip>
          <Tooltip title="Menu">
            <IconButton sx={{ p: { xs: 0.25, sm: 1 } }} aria-label="Menu" aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)} onClick={(event) => setMenuAnchor(event.currentTarget)}><MenuRounded /></IconButton>
          </Tooltip>
          <Menu anchorEl={menuAnchor} onClose={() => setMenuAnchor(null)} open={Boolean(menuAnchor)} slotProps={{ paper: { sx: { minWidth: 250, mt: 1 } } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1 }}>
              <Typography color="text.secondary" variant="body2">Theme</Typography>
              <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_event, value: 'light' | 'system' | 'dark' | null) => { if (value) setMode(value) }} aria-label="Theme" sx={{ '& .MuiToggleButton-root': { py: '4px' } }}>
                <ToggleButton value="light" aria-label="Light theme"><LightModeRounded fontSize="small" sx={{ color: '#e9b969' }} /></ToggleButton>
                <ToggleButton value="system" aria-label="System theme"><BrightnessAutoRounded fontSize="small" sx={{ color: '#92bcad' }} /></ToggleButton>
                <ToggleButton value="dark" aria-label="Dark theme"><DarkModeRounded fontSize="small" sx={{ color: '#b3a4df' }} /></ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Divider />
            <MenuItem onClick={() => { setMenuAnchor(null); setAboutOpen(true) }}>
              <ListItemIcon><InfoOutlined /></ListItemIcon><ListItemText>About…</ListItemText>
              <Typography color="text.secondary" variant="body2">{version}</Typography>
            </MenuItem>
            <Divider />
            <MenuItem disabled={logoutState.isLoading} onClick={() => { setMenuAnchor(null); void endSession() }}>
              <ListItemIcon><LogoutRounded /></ListItemIcon><ListItemText primary="Log out" secondary={user.email} />
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Dialog fullWidth maxWidth="xs" onClose={() => setAboutOpen(false)} open={aboutOpen}>
        <DialogTitle>About Health<IconButton className="quiet-red-action" aria-label="Close about" onClick={() => setAboutOpen(false)} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseRounded /></IconButton></DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <HealthLogo size={56} />
            <Typography color="text.secondary">Your activities and health data in one place.</Typography>
            <Typography>Version: {version}{deployedAt && ` (${deployedAt})`}</Typography>
            <Typography>Author: <Link href="https://github.com/domyshev" target="_blank" rel="noopener noreferrer">domyshev</Link></Typography>
            <Typography>Source code: <Link href="https://github.com/domyshev/health" target="_blank" rel="noopener noreferrer">github.com/domyshev/health</Link></Typography>
          </Stack>
        </DialogContent>
      </Dialog>

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
      <Box component="main" sx={{ mx: 'auto', maxWidth: 1180, px: { xs: 2, sm: 4 }, pt: 2, pb: { xs: 2, sm: 4 } }}>
        <Routes>
          <Route element={<ActivitiesPage />} path="/" />
          <Route element={<ActivityDetailsPage />} path="/activities/:activityId" />
          <Route element={<ActivitiesPage />} path="*" />
        </Routes>
      </Box>
      <Help key={user.id} userId={user.id} statisticsOpen={helpStatisticsOpen} onCloseStatistics={() => setHelpStatisticsOpen(false)} />
      <GarminDrawer onClose={() => setDrawerOpen(false)} open={drawerOpen} />
      <Box aria-live="polite" sx={{ height: 0, overflow: 'hidden' }}>{syncLabel}</Box>
    </Box>
  )
}
