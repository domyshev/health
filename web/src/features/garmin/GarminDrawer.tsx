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
  const { data: connection, isLoading } = useGetGarminConnectionQuery(undefined, { skip: !open })
  const [connectGarmin, connectState] = useConnectGarminMutation()
  const [verifyMfa, verifyState] = useVerifyGarminMfaMutation()

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => emailRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [open])

  function closeDrawer() {
    setPassword('')
    setMfaCode('')
    setChallenge(undefined)
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
    } catch {
      setMfaCode('')
    }
  }

  const connected = connection?.status === 'connected'

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

        {isLoading ? <CircularProgress aria-label="Loading Garmin status" /> : (
          <Alert icon={<LinkRounded />} severity={connected ? 'success' : connection?.status === 'reconnect_required' ? 'warning' : 'info'}>
            <strong>{connected ? 'Connected' : connection?.status === 'reconnect_required' ? 'Reconnect required' : 'Not connected'}</strong>
            {connection?.garminEmail && <div>{connection.garminEmail}</div>}
            {connection?.lastSuccessfulSyncAt && (
              <div title={connection.lastSuccessfulSyncAt}>Last sync {new Date(connection.lastSuccessfulSyncAt).toLocaleString()}</div>
            )}
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
        ) : (
          <Box component="form" onSubmit={(event) => void connect(event)}>
            <Stack spacing={2}>
              <Typography sx={{ fontWeight: 700 }}>{connected ? 'Refresh access' : 'Connect Garmin'}</Typography>
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
                {connectState.isLoading ? <CircularProgress size={22} /> : connected ? 'Refresh access' : 'Connect Garmin'}
              </Button>
            </Stack>
          </Box>
        )}
      </Stack>
    </Drawer>
  )
}
