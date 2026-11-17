import { expect, test, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

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

test('passwordless login opens the dashboard and logout ends the server session', async ({ page }) => {
  await mockBaseApi(page, false)
  await page.goto('/')

  const email = page.getByLabel('Email')
  await email.fill('runner@example.com')
  await email.press('Tab')
  await expect(page.getByRole('button', { name: 'Send code' })).toBeFocused()
  await page.keyboard.press('Enter')
  const code = page.getByLabel('Verification code')
  await expect(code).toBeFocused()
  await code.fill('123456')
  await code.press('Enter')

  await expect(page.getByRole('heading', { name: 'Activities', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByText('runner@example.com')).toBeVisible()
  await page.getByRole('menuitem', { name: /Log out/ }).click()
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
        id: 'run-1', status: syncReads > 1 ? 'succeeded' : 'running', startedAt: '2026-09-21T13:00:00Z', finishedAt: '2026-09-21T13:01:00Z',
        discoveredCount: 1, importedCount: syncReads > 1 ? 1 : 0, updatedCount: 0, failedCount: 0,
      })
    }
    return fulfill(route, {}, 404)
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Sync now' }).click()
  // The app polls active sync runs every ten seconds.
  await expect(page.getByText('Synced:').first()).toBeVisible({ timeout: 15_000 })
  await page.getByRole('checkbox', { name: 'Swimming', exact: true }).click()
  await expect.poll(() => filtered).toBe(true)
})

test('login and dashboard pass automated accessibility checks', async ({ page }) => {
  await mockBaseApi(page, false)
  await page.goto('/')

  const loginResults = await new AxeBuilder({ page }).analyze()
  expect(loginResults.violations).toEqual([])

  await page.getByLabel('Email').fill('runner@example.com')
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByLabel('Verification code').fill('123456')
  await page.getByRole('button', { name: 'Verify' }).click()
  await expect(page.getByRole('heading', { name: 'Activities', exact: true })).toBeVisible()

  const dashboardResults = await new AxeBuilder({ page }).analyze()
  expect(dashboardResults.violations).toEqual([])
})

test('cardio field choices remain separate in list and detail views', async ({ page }) => {
  await mockBaseApi(page)
  const activity = { id: '11111111-1111-4111-8111-111111111111', type: 'cardio', name: 'Cardio session', startedAt: '2026-09-21T13:00:00Z', distanceM: 1200, durationS: 1800 }
  const settings: { type: string; view: string; fields: string[] }[] = []
  await page.route('**/v1/activities**', async (route) => {
    const url = new URL(route.request().url())
    await fulfill(route, url.pathname === '/v1/activities' ? { items: [activity], nextCursor: '' } : activity)
  })
  await page.route('**/v1/activity-field-settings', async (route) => {
    if (route.request().method() === 'POST') {
      const value = route.request().postDataJSON() as { type: string; view: string; fields: string[] }
      const index = settings.findIndex((item) => item.type === value.type && item.view === value.view)
      if (index >= 0) settings[index] = value
      else settings.push(value)
      await fulfill(route, value)
    } else await fulfill(route, { items: settings })
  })
  await page.goto('/')
  const card = page.getByRole('link', { name: /cardio session/i })
  await expect(card).toBeVisible()
  const icon = await card.getByRole('img', { name: 'Cardio session' }).boundingBox()
  expect(icon?.width).toBe(48)
  expect(icon?.height).toBe(36)
  await expect(card.getByText('1.20 km')).toHaveCount(0)
  await page.getByRole('button', { name: 'Choose list fields for cardio' }).click()
  await page.getByRole('checkbox', { name: 'Distance' }).check()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(card.getByText('1.20 km')).toBeVisible()
  await card.click()
  await expect(page.getByRole('heading', { name: 'Cardio session' })).toBeVisible()
  await expect(page.getByText('1.20 km')).toHaveCount(0)
  await page.getByRole('button', { name: 'Choose detail fields for cardio' }).click()
  await expect(page.getByRole('checkbox', { name: 'Distance' })).not.toBeChecked()
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('link', { name: /back to activities/i }).click()
  await expect(page.getByRole('link', { name: /cardio session/i }).getByText('1.20 km')).toBeVisible()
})

test('theme choice persists after reload', async ({ page }) => {
  await mockBaseApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: 'Light theme' }).click()
  await expect(page.getByRole('button', { name: 'Light theme' })).toHaveAttribute('aria-pressed', 'true')
  await page.reload()
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('button', { name: 'Light theme' })).toHaveAttribute('aria-pressed', 'true')
})

test('activity chips and spiral button work in both themes', async ({ page }, testInfo) => {
  await mockBaseApi(page)
  await page.goto('/')
  const help = page.getByRole('button', { name: 'Help me. Drag to move' })
  const helpSize = testInfo.project.name.includes('mobile') ? '56px' : '46px'
  await expect(help).toHaveCSS('width', helpSize)
  await expect(help).toHaveCSS('height', helpSize)
  await expect(page.getByText('A focused record of every imported workout.')).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Running', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Swimming', exact: true }).click()
  await expect(page.getByRole('checkbox', { name: 'Running', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Swimming', exact: true })).toBeChecked()
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: 'Menu', exact: true }).click()
    await page.getByRole('button', { name: `${theme} theme` }).click()
    await expect(page.locator('body')).toHaveCSS('background-color', theme === 'Light' ? 'rgb(244, 244, 244)' : 'rgb(16, 16, 16)')
    await expect(page.getByRole('button', { name: `${theme} theme` })).toHaveCSS('height', '30px')
    await page.screenshot({ path: testInfo.outputPath(`${theme.toLowerCase()}-menu.png`), animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(page.locator('.MuiMenu-root')).toHaveCount(0)
    await page.mouse.move(0, 0)
    await help.focus()
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
    await help.focus()
    await expect(help).toHaveCSS('outline-style', 'solid')
    await expect(help).not.toHaveCSS('box-shadow', 'none')
    await page.screenshot({ path: testInfo.outputPath(`${theme.toLowerCase()}-dashboard.png`), animations: 'disabled' })
    expect(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
  }
  await help.click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('help button uses the requested size and stays within the viewport when moved', async ({ page }, testInfo) => {
  await mockBaseApi(page)
  await page.goto('/')
  const button = page.getByRole('button', { name: /help me/i })
  const box = await button.boundingBox()
  expect(box).not.toBeNull()
  const mobile = testInfo.project.name.includes('mobile')
  expect(box!.width).toBe(mobile ? 56 : 46)
  expect(box!.height).toBe(mobile ? 56 : 46)
  expect(page.viewportSize()!.width - box!.x - box!.width).toBe(16)
  await button.focus()
  await page.keyboard.press('ArrowRight')
  const moved = await button.boundingBox()
  expect(moved!.x + moved!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
})

test('breadcrumb shows a non-interactive home icon and the current page', async ({ page }, testInfo) => {
  await mockBaseApi(page)
  if (testInfo.project.name.includes('mobile')) await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('/')
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' })
  const home = breadcrumb.getByRole('img', { name: 'Home' })
  await expect(home).toBeVisible()
  await expect(breadcrumb.getByRole('link', { name: 'Home' })).toHaveCount(0)
  await expect(breadcrumb.getByRole('heading', { name: 'Activities' })).toHaveAttribute('aria-current', 'page')
  await expect(breadcrumb).toHaveCSS('font-size', '16px')
  await home.click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Activities', exact: true })).toBeVisible()
})

test('activity icons have no background and follow the selected theme', async ({ page }) => {
  await mockBaseApi(page)
  const types = ['swimming', 'walking', 'strength', 'cycling', 'elliptical', 'cardio', 'running', 'other']
  await page.route('**/v1/activities?**', async (route) => {
    await fulfill(route, { items: types.map((type, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, type, name: `${type} session` })), nextCursor: '' })
  })
  await page.goto('/')
  const icon = page.getByRole('img', { name: 'walking session' })
  await expect(icon).toBeVisible()
  await expect(icon).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(icon).toHaveCSS('color', 'rgb(245, 245, 245)')
  for (const type of types) {
    const item = page.getByRole('img', { name: `${type} session` })
    await expect(item.locator('svg path[fill="#d5a43e"]')).toHaveCount(7)
  }
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: 'Light theme' }).click()
  await page.keyboard.press('Escape')
  await expect(icon).toHaveCSS('color', 'rgb(22, 22, 22)')
  await expect(icon).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
})

test('help uses a glass button and a colorful square illustration', async ({ page }) => {
  await mockBaseApi(page)
  await page.goto('/')
  const fab = page.getByRole('button', { name: /help me/i })
  await expect(fab).toHaveCSS('backdrop-filter', /blur\(16px\)/)
  await fab.click()
  const popover = page.getByRole('dialog', { name: 'Life situations' })
  await expect(popover).toBeVisible()
  const fabBox = await fab.boundingBox()
  const popoverBox = await popover.boundingBox()
  const arrowBox = await popover.locator('.help-arrow').boundingBox()
  expect(popoverBox!.y + popoverBox!.height).toBeLessThan(fabBox!.y)
  expect(Math.abs(arrowBox!.x + arrowBox!.width / 2 - (fabBox!.x + fabBox!.width / 2))).toBeLessThan(2)
  const picture = page.getByRole('button', { name: 'I want to eat something sweet' })
  const box = await picture.boundingBox()
  expect(box?.width).toBe(box?.height)
  await expect(picture.locator('img')).toHaveCSS('filter', 'none')
  await picture.click()
  await expect(page.getByRole('group', { name: 'Choose a sweet' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover).not.toBeVisible()
  await expect(fab).toBeFocused()
  for (let i = 0; i < 50; i += 1) await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(popover).toBeVisible()
  const movedFab = await fab.boundingBox()
  const movedPopover = await popover.boundingBox()
  expect(movedPopover!.y).toBeGreaterThan(movedFab!.y + movedFab!.height)
})

test('back and close controls brighten on hover without a background', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('mobile'), 'hover is tested with a pointer')
  await mockBaseApi(page)
  await page.route('**/v1/activities/*', async (route) => {
    await fulfill(route, { id: '11111111-1111-4111-8111-111111111111', type: 'cardio', name: 'Training' })
  })
  await page.goto('/activities/11111111-1111-4111-8111-111111111111')
  const back = page.getByRole('link', { name: 'Back to activities' })
  await expect(back).toBeVisible()
  await expect(back).toHaveCSS('color', 'rgb(239, 68, 68)')
  await back.hover()
  await expect(back).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(back).toHaveCSS('color', 'rgb(255, 133, 133)')
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('menuitem', { name: /about/i }).click()
  const close = page.getByRole('button', { name: 'Close about' })
  await expect(close).toHaveCSS('color', 'rgb(239, 68, 68)')
  await close.hover()
  await expect(close).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(close).toHaveCSS('color', 'rgb(255, 133, 133)')
})

test('Life situations restores an unfinished choice within the tab', async ({ page }) => {
  await mockBaseApi(page)
  let savedNote = ''
  await page.route('**/v1/help-notes', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { note: string }
      savedNote = body.note
      await fulfill(route, { id: 'note-1', note: body.note, createdAt: '2026-01-01T00:00:00Z' })
    } else await fulfill(route, { items: [] })
  })
  await page.goto('/')
  const fab = page.getByRole('button', { name: /help me/i })
  await fab.click()
  const intro = page.getByRole('button', { name: 'I want to eat something sweet' })
  await expect(intro).toHaveCSS('border-radius', '0px')
  await expect(intro).toHaveCSS('border-width', '0px')
  await expect(page.getByRole('group', { name: 'Choose a sweet' })).toHaveCount(0)
  await expect(page.getByLabel('Calories (optional)')).toHaveCount(0)
  await intro.click()
  const choices = page.getByRole('group', { name: 'Choose a sweet' })
  await expect(choices.getByRole('button')).toHaveCount(6)
  await expect(page.getByLabel('Calories (optional)')).toHaveCount(0)
  await expect(choices.getByRole('button', { name: 'Candy', exact: true })).toHaveCSS('border-radius', '0px')
  await choices.getByRole('button', { name: 'Candy', exact: true }).click()
  await page.getByLabel('Calories (optional)').fill('42')
  await fab.click()
  await expect(page.getByRole('dialog', { name: 'Life situations' })).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: /help me/i }).click()
  await expect(page.getByLabel('Calories (optional)')).toHaveValue('42')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => savedNote).toBe('Wanted to eat: Candy · 42 kcal')
  await page.getByRole('button', { name: /help me/i }).click()
  await expect(page.getByRole('button', { name: 'I want to eat something sweet' })).toBeVisible()
})

test('touch shows image tooltips until the finger is lifted', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'touch-specific flow')
  await mockBaseApi(page)
  await page.goto('/')
  await page.getByRole('button', { name: /help me/i }).tap()
  const touch = await page.context().newCDPSession(page)
  async function hold(locator: ReturnType<typeof page.getByRole>) {
    const box = await locator.boundingBox()
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }] })
  }
  async function release() {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await hold(page.getByRole('button', { name: 'I want to eat something sweet' }))
  await expect(page.getByRole('tooltip')).toHaveText('I want to eat something sweet')
  await expect(page.getByRole('group', { name: 'Choose a sweet' })).toHaveCount(0)
  await release()
  await expect(page.getByRole('group', { name: 'Choose a sweet' })).toBeVisible()
  await hold(page.getByRole('button', { name: 'Candy', exact: true }))
  await expect(page.getByRole('tooltip')).toHaveText('Candy')
  await expect(page.getByLabel('Calories (optional)')).toHaveCount(0)
  await release()
  await expect(page.getByLabel('Calories (optional)')).toBeVisible()
})
