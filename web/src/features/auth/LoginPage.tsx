import { useEffect, useState, type FormEvent } from 'react'
import { useDispatch } from 'react-redux'
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded'
import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, TextField, Typography } from '@mui/material'

import { healthApi, useRequestCodeMutation, useVerifyCodeMutation } from '../../api/healthApi'
import type { AppDispatch } from '../../store'

function requestErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { code?: string } }).data
    if (data?.code === 'rate_limited') return 'Too many code requests. Wait a moment and try again.'
  }
  return 'The code request could not be completed. Try again.'
}

export function LoginPage() {
  const dispatch = useDispatch<AppDispatch>()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [requestCode, requestState] = useRequestCodeMutation()
  const [verifyCode, verifyState] = useVerifyCodeMutation()

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [cooldown])

  async function submitEmail(event: FormEvent) {
    event.preventDefault()
    try {
      await requestCode({ email }).unwrap()
      setCooldown(30)
      setStep('code')
    } catch {
      // The neutral API response normally prevents account enumeration.
    }
  }

  async function resendCode() {
    if (cooldown > 0) return
    try {
      await requestCode({ email }).unwrap()
      setCooldown(30)
    } catch {
      // Keep the result neutral so the UI does not reveal allowlist membership.
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault()
    try {
      await verifyCode({ email, code }).unwrap()
      dispatch(healthApi.util.invalidateTags(['Session']))
    } catch {
      // Mutation state renders the stable error below.
    }
  }

  return (
    <Box component="main" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card sx={{ width: 'min(100%, 440px)', borderRadius: 5, overflow: 'hidden' }}>
        <Box sx={{ height: 6, bgcolor: 'primary.main' }} />
        <CardContent sx={{ p: { xs: 3, sm: 5 } }}>
          <Stack spacing={3}>
            <Box>
              <Typography color="primary" sx={{ fontWeight: 800, letterSpacing: '0.08em' }} variant="overline">
                Health Hub
              </Typography>
              <Typography component="h1" variant="h2">Your training, privately organized.</Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                Sign in with the one-time code sent to your email.
              </Typography>
            </Box>

            {step === 'email' ? (
              <Box component="form" onSubmit={(event) => void submitEmail(event)}>
                <Stack spacing={2}>
                  <TextField
                    autoComplete="email"
                    label="Email"
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    type="email"
                    value={email}
                  />
                  {requestState.isError && <Alert severity="error">{requestErrorMessage(requestState.error)}</Alert>}
                  <Button endIcon={<ArrowForwardRounded />} type="submit" variant="contained">
                    {requestState.isLoading ? <CircularProgress color="inherit" size={22} /> : 'Send code'}
                  </Button>
                </Stack>
              </Box>
            ) : (
              <Box component="form" onSubmit={(event) => void submitCode(event)}>
                <Stack spacing={2}>
                  <Alert severity="info">If the address is allowed, a code was sent to {email}.</Alert>
                  <TextField
                    autoComplete="one-time-code"
                    autoFocus
                    label="Verification code"
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
                    required
                    slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6, pattern: '[0-9]{4,6}' } }}
                    value={code}
                  />
                  {verifyState.isError && <Alert severity="error">The code is invalid or expired.</Alert>}
                  {requestState.isError && <Alert severity="error">{requestErrorMessage(requestState.error)}</Alert>}
                  <Button disabled={code.length < 4} type="submit" variant="contained">
                    {verifyState.isLoading ? <CircularProgress color="inherit" size={22} /> : 'Verify'}
                  </Button>
                  <Button disabled={cooldown > 0 || requestState.isLoading} onClick={() => void resendCode()}>
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                  </Button>
                  <Button onClick={() => { setStep('email'); setCode(''); setCooldown(0) }}>Use another email</Button>
                </Stack>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  )
}
