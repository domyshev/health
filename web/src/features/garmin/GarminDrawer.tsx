import { useEffect, useRef, useState, type FormEvent } from 'react'
import CloseRounded from '@mui/icons-material/CloseRounded'
import LinkRounded from '@mui/icons-material/LinkRounded'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'

import {
  useConnectGarminMutation,
  useGetGarminConnectionQuery,
  useGetSyncRunQuery,
  useStartSyncMutation,
  useVerifyGarminMfaMutation,
} from '../../api/healthApi'

interface GarminDrawerProps {
  open: boolean
  onClose: () => void
}

export function GarminDrawer({ open, onClose }: GarminDrawerProps) {
  const emailRef = useRef<HTMLInputElement>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [challenge, setChallenge] = useState<{ id: string; expiresAt?: string }>()
  const [showCredentialsForm, setShowCredentialsForm] = useState(false)
  const [connectionComplete, setConnectionComplete] = useState(false)
  const [fullHistoryRunId, setFullHistoryRunId] = useState<string>()
  const {
    data: connection,
    isError: connectionError,
    isLoading,
    refetch,
  } = useGetGarminConnectionQuery(undefined, { skip: !open })
  const [connectGarmin, connectState] = useConnectGarminMutation()
  const [verifyMfa, verifyState] = useVerifyGarminMfaMutation()
  const [startSync, syncState] = useStartSyncMutation()
  const { data: fullHistoryRun } = useGetSyncRunQuery(fullHistoryRunId ?? '', {
    skip: !fullHistoryRunId,
    pollingInterval: fullHistoryRunId ? 10_000 : 0,
  })

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => emailRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [open])

  function closeDrawer() {
    setPassword('')
    setMfaCode('')
    setChallenge(undefined)
    setShowCredentialsForm(false)
    setConnectionComplete(false)
    onClose()
  }

  async function connect(event: FormEvent) {
    event.preventDefault()
    try {
      const result = await connectGarmin({ email, password }).unwrap()
      setPassword('')
      if (result.status === 'mfa_required' && result.challengeId) {
        setChallenge({ id: result.challengeId, expiresAt: result.expiresAt })
      } else {
        setChallenge(undefined)
        setConnectionComplete(true)
        setShowCredentialsForm(false)
      }
    } catch {
      setPassword('')
    }
  }

  async function submitMfa(event: FormEvent) {
    event.preventDefault()
    if (!challenge) return
    try {
      await verifyMfa({ challengeId: challenge.id, code: mfaCode }).unwrap()
      setMfaCode('')
      setChallenge(undefined)
      setConnectionComplete(true)
      setShowCredentialsForm(false)
    } catch {
      setMfaCode('')
    }
  }

  async function startInitialSync(mode: 'recent' | 'full_history') {
    try {
      const result = await startSync({ mode }).unwrap()
      setFullHistoryRunId(result.syncRunId)
      setConnectionComplete(false)
      void refetch()
    } catch {
      // Mutation state provides the user-facing error.
    }
  }

  async function importFullHistory() {
    await startInitialSync('full_history')
  }

  const connected = connection?.status === 'connected' || connection?.status === 'active'
  const displayConnected = connected || connectionComplete
  const reconnectRequired = connection?.status === 'reconnect_required' || connection?.status === 'reauth_required'

  return (
    <Drawer
      anchor="right"
      onClose={closeDrawer}
      open={open}
      slotProps={{ paper: { sx: { width: { xs: '94vw', sm: 440 }, p: { xs: 2.5, sm: 4 } } } }}
    >
      <Stack spacing={3}>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Box>
            <Typography color="primary" variant="overline">Integration</Typography>
            <Typography component="h2" variant="h4">Garmin</Typography>
          </Box>
          <Tooltip title="Close Garmin settings">
            <IconButton aria-label="Close Garmin settings" onClick={closeDrawer}><CloseRounded /></IconButton>
          </Tooltip>
        </Stack>

        {connectionError && (
          <Alert action={<Button onClick={() => void refetch()}>Retry</Button>} severity="error">
            Garmin status could not be loaded. Existing Health Hub data is unaffected.
          </Alert>
        )}
        {isLoading ? <CircularProgress aria-label="Loading Garmin status" /> : !connectionError && (
          <Alert icon={<LinkRounded />} severity={displayConnected ? 'success' : reconnectRequired ? 'warning' : 'info'}>
            <strong>{displayConnected ? 'Connected' : reconnectRequired ? 'Reconnect required' : 'Not connected'}</strong>
            {connection?.garminEmail && <div>{connection.garminEmail}</div>}
            {connection?.lastSuccessfulSyncAt && (
              <div title={connection.lastSuccessfulSyncAt}>Last sync {new Date(connection.lastSuccessfulSyncAt).toLocaleString()}</div>
            )}
          </Alert>
        )}

        {connection?.lastErrorCode && (
          <Alert severity="warning">
            {connection.lastErrorCode === 'garmin_reconnect_required'
              ? 'Garmin access must be refreshed before the next sync.'
              : 'The last Garmin operation did not complete. Refresh access or try again.'}
          </Alert>
        )}

        <Divider />

        {challenge ? (
          <Box component="form" onSubmit={(event) => void submitMfa(event)}>
            <Stack spacing={2}>
              <Typography sx={{ fontWeight: 700 }}>Garmin MFA required</Typography>
              <Typography color="text.secondary" variant="body2">
                Enter the code from Garmin. This challenge stays only in memory and expires{challenge.expiresAt ? ` at ${new Date(challenge.expiresAt).toLocaleTimeString()}` : ' shortly'}.
              </Typography>
              <TextField
                autoFocus
                error={verifyState.isError}
                helperText={verifyState.isError ? 'The MFA code was rejected or expired.' : undefined}
                label="MFA code"
                onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, ''))}
                slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 8 } }}
                value={mfaCode}
              />
              <Button disabled={!mfaCode} type="submit" variant="contained">Verify MFA</Button>
              <Button onClick={() => { setChallenge(undefined); setMfaCode('') }}>Start over</Button>
            </Stack>
          </Box>
        ) : connectionComplete ? (
          <Stack spacing={2}>
            <Alert severity="success">Garmin authorization completed successfully.</Alert>
            <Typography sx={{ fontWeight: 700 }}>How would you like to sync your data?</Typography>
            <Typography color="text.secondary" variant="body2">
              Quick sync imports your 100 most recent Garmin activities. Full history imports every activity Garmin makes available and can take a while.
            </Typography>
            {syncState.isError && <Alert severity="error">Synchronization could not be started. Try again.</Alert>}
            <Button disabled={syncState.isLoading} onClick={() => void startInitialSync('full_history')} variant="contained">
              {syncState.isLoading ? <CircularProgress color="inherit" size={22} /> : 'Import full history'}
            </Button>
            <Button disabled={syncState.isLoading} onClick={() => void startInitialSync('recent')} variant="outlined">Quick sync</Button>
            <Typography color="text.secondary" variant="caption">
              You can start a full import later in Garmin settings, under Full Garmin history.
            </Typography>
          </Stack>
        ) : displayConnected && !showCredentialsForm ? (
          <Stack spacing={2}>
            <Alert severity="success">
              Garmin authorization completed successfully. You can now start synchronization.
            </Alert>
            <Button
              onClick={() => {
                setEmail(connection?.garminEmail ?? email)
                setShowCredentialsForm(true)
              }}
              variant="outlined"
            >
              Refresh access
            </Button>
            <Divider />
            <Box>
              <Typography sx={{ fontWeight: 700 }}>Full Garmin history</Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }} variant="body2">
                Import every activity available from Garmin. This can take a while; ordinary Sync only checks recent activity.
              </Typography>
              {fullHistoryRun?.status === 'running' && <Alert icon={<CircularProgress size={20} />} severity="info" sx={{ mt: 1.5 }}>Importing history: {fullHistoryRun.discoveredCount} discovered, {fullHistoryRun.importedCount + fullHistoryRun.updatedCount} saved so far.</Alert>}
              {fullHistoryRun?.status === 'complete' && <Alert severity="success" sx={{ mt: 1.5 }}>Full history import complete: {fullHistoryRun.importedCount} new and {fullHistoryRun.updatedCount} updated activities.</Alert>}
              {fullHistoryRun?.status === 'partial' || fullHistoryRun?.status === 'failed' ? <Alert severity="error" sx={{ mt: 1.5 }}>Full history import did not complete. Refresh Garmin access and try again.</Alert> : null}
              {syncState.isError && <Alert severity="error" sx={{ mt: 1.5 }}>Full history import could not be started. Try again.</Alert>}
              {syncState.isSuccess && !fullHistoryRun && <Alert severity="success" sx={{ mt: 1.5 }}>Full history import was accepted; preparing progress…</Alert>}
              <Button disabled={syncState.isLoading || fullHistoryRun?.status === 'running'} onClick={() => void importFullHistory()} sx={{ mt: 1.5 }} variant="contained">
                {syncState.isLoading || fullHistoryRun?.status === 'running' ? <CircularProgress color="inherit" size={22} /> : 'Import full history'}
              </Button>
            </Box>
          </Stack>
        ) : (
          <Box component="form" onSubmit={(event) => void connect(event)}>
            <Stack spacing={2}>
              <Typography sx={{ fontWeight: 700 }}>{displayConnected ? 'Refresh access' : 'Connect Garmin'}</Typography>
              <Typography color="text.secondary" variant="body2">
                Credentials are sent once to the Health Hub API and are never saved by this web app.
              </Typography>
              <TextField
                autoComplete="username"
                inputRef={emailRef}
                label="Garmin email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
              <TextField
                autoComplete="current-password"
                error={connectState.isError}
                helperText={connectState.isError ? 'Garmin authentication failed. Check your credentials and try again.' : undefined}
                label="Garmin password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
              <Button disabled={!email || !password} type="submit" variant="contained">
                {connectState.isLoading ? <CircularProgress color="inherit" size={22} /> : displayConnected ? 'Refresh access' : 'Connect Garmin'}
              </Button>
            </Stack>
          </Box>
        )}
      </Stack>
    </Drawer>
  )
}
