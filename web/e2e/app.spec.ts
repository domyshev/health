import { expect, test, type Page, type Route } from '@playwright/test'

const user = { id: 'user-1', email: 'runner@example.com', displayName: 'Runner', role: 'user' }

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: status === 204 ? '' : JSON.stringify(body),
  })
}

async function mockBaseApi(page: Page, authenticated = true) {
  let signedIn = authenticated
  await page.route('**/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/v1/me') {
      await fulfill(route, signedIn ? user : { error: { code: 'unauthorized', message: 'sign in required' } }, signedIn ? 200 : 401)
      return
    }
    if (url.pathname === '/v1/auth/request-code') {
      await fulfill(route, { status: 'accepted' }, 202)
      return
    }
    if (url.pathname === '/v1/auth/verify-code') {
      signedIn = true
      await fulfill(route, user)
      return
    }
    if (url.pathname === '/v1/auth/logout') {
      signedIn = false
      await fulfill(route, undefined, 204)
      return
    }
    if (url.pathname === '/v1/activities') {
      await fulfill(route, { items: [], nextCursor: '' })
      return
    }
    if (url.pathname === '/v1/integrations/garmin') {
      await fulfill(route, { status: 'not_connected' })
      return
    }
    await fulfill(route, { error: { code: 'not_found', message: url.pathname } }, 404)
  })
}

test('passwordless login opens the dashboard and logout ends the server session', async ({ page }, testInfo) => {
  await mockBaseApi(page, false)
  await page.goto('/')

  await page.getByLabel('Email').fill('runner@example.com')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Verification code').fill('123456')
  await page.getByRole('button', { name: 'Verify' }).click()

  await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible()
  if (!testInfo.project.name.includes('mobile')) await expect(page.getByText('Runner')).toBeVisible()
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: /privately organized/i })).toBeVisible()
})

test('Garmin MFA remains usable on a mobile viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'mobile-specific flow')
  let connected = false
  await page.route('**/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/v1/me') return fulfill(route, user)
    if (url.pathname === '/v1/activities') return fulfill(route, { items: [], nextCursor: '' })
    if (url.pathname === '/v1/integrations/garmin' && request.method() === 'GET') {
      return fulfill(route, { status: connected ? 'connected' : 'not_connected' })
    }
    if (url.pathname.endsWith('/connect')) {
      return fulfill(route, { status: 'mfa_required', challengeId: 'challenge-1' })
    }
    if (url.pathname.includes('/challenges/challenge-1/verify')) {
      connected = true
      return fulfill(route, { status: 'connected' })
    }
    return fulfill(route, {}, 404)
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Garmin settings' }).click()
  await page.getByLabel('Garmin email').fill('athlete@example.com')
  await page.getByLabel('Garmin password').fill('not-stored')
  await page.getByRole('button', { name: 'Connect Garmin' }).click()
  await expect(page.getByLabel('Garmin password')).toHaveCount(0)
  await page.getByLabel('MFA code').fill('654321')
  await page.getByRole('button', { name: 'Verify MFA' }).click()
  await expect(page.getByText('Connected')).toBeVisible()
})

test('manual sync reaches completion and activity filter updates the cursor query', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'desktop flow')
  let syncReads = 0
  let filtered = false
  await page.route('**/v1/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/v1/me') return fulfill(route, user)
    if (url.pathname === '/v1/integrations/garmin') return fulfill(route, { status: 'connected' })
    if (url.pathname === '/v1/activities') {
      filtered ||= url.searchParams.get('type') === 'swimming'
      return fulfill(route, { items: [], nextCursor: '' })
    }
    if (url.pathname === '/v1/sync-runs' && request.method() === 'POST') {
      return fulfill(route, { syncRunId: 'run-1', status: 'queued' }, 202)
    }
    if (url.pathname === '/v1/sync-runs/run-1') {
      syncReads += 1
      return fulfill(route, {
        id: 'run-1', status: syncReads > 1 ? 'succeeded' : 'running', startedAt: '2026-09-21T13:00:00Z',
        discoveredCount: 1, importedCount: syncReads > 1 ? 1 : 0, updatedCount: 0, failedCount: 0,
      })
    }
    return fulfill(route, {}, 404)
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByText('Sync complete').first()).toBeVisible()
  await page.getByLabel('Activity type').click()
  await page.getByRole('option', { name: 'swimming' }).click()
  await expect.poll(() => filtered).toBe(true)
})
