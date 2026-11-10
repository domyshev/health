import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ActivitiesPage } from './ActivitiesPage'
import { TestProviders } from '../../test/TestProviders'

afterEach(() => vi.unstubAllGlobals())

function page(name: string, nextCursor: string) {
  return new Response(
    JSON.stringify({
      items: [
        {
          id: crypto.randomUUID(),
          type: 'swimming',
          name,
          startedAt: '2026-09-20T06:30:00Z',
          distanceM: 1500,
          durationS: 2400,
          caloriesKcal: 420,
          averageHrBpm: 132,
          averagePacePer100mS: 100,
          swimEnvironment: 'pool',
        },
      ],
      nextCursor,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

describe('activities', () => {
  it('filters by activity type and appends cursor pages', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('cursor=next-page')) return page('Evening swim', '')
      return page('Morning swim', 'next-page')
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<ActivitiesPage />, { wrapper: TestProviders })

    const icon = await screen.findByRole('img', { name: 'Morning swim' })
    expect(icon).toBeInTheDocument()
    await user.hover(icon)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Morning swim')
    await user.unhover(icon)
    expect(screen.getAllByText(/420 kcal/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/pool · 1:40 \/100m/i).length).toBeGreaterThan(0)
    await user.click(screen.getByLabelText(/activity type/i))
    await user.click(screen.getByRole('option', { name: 'swimming' }))
    await user.click(await screen.findByRole('button', { name: /load more/i }))

    expect(await screen.findByRole('img', { name: 'Evening swim' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Morning swim' })).toBeInTheDocument()
    await waitFor(() => {
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('cursor=next-page')
    })
  })

  it('does not reuse a cursor from the previous filter', async () => {
    const requestedUrls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url.includes('type=running')) return page('Filtered run', '')
      return page('Unfiltered activity', 'all-next')
    })
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<ActivitiesPage />, { wrapper: TestProviders })

    expect(await screen.findByRole('img', { name: 'Unfiltered activity' })).toBeInTheDocument()
    await user.click(screen.getByLabelText(/activity type/i))
    await user.click(screen.getByRole('option', { name: 'running' }))
    expect(await screen.findByRole('img', { name: 'Filtered run' })).toBeInTheDocument()

    expect(requestedUrls.some((url) => url.includes('type=running') && url.includes('cursor=all-next'))).toBe(false)
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument()
  })

  it('omits unavailable metrics instead of rendering placeholders', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [{ id: crypto.randomUUID(), type: 'strength', name: 'Strength session' }],
        nextCursor: '',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ))

    render(<ActivitiesPage />, { wrapper: TestProviders })

    expect(await screen.findByRole('img', { name: 'Strength session' })).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('shows separate icons for cardio and other activities', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        items: [
          { id: crypto.randomUUID(), type: 'cardio', name: 'Cardio training' },
          { id: crypto.randomUUID(), type: 'other', name: 'Yoga' },
        ],
        nextCursor: '',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ))

    render(<ActivitiesPage />, { wrapper: TestProviders })

    expect(within(await screen.findByRole('img', { name: 'Cardio training' })).getByTestId('MonitorHeartRoundedIcon')).toBeInTheDocument()
    expect(within(screen.getByRole('img', { name: 'Yoga' })).getByTestId('MoreHorizRoundedIcon')).toBeInTheDocument()
  })

  it('distinguishes an empty filter from an account with no activities', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => (
      new Response(JSON.stringify({ items: [], nextCursor: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )))
    const user = userEvent.setup()

    render(<ActivitiesPage />, { wrapper: TestProviders })

    expect(await screen.findByText('No activities yet')).toBeInTheDocument()
    await user.click(screen.getByLabelText(/activity type/i))
    await user.click(screen.getByRole('option', { name: 'cycling' }))

    expect(await screen.findByText('No cycling activities')).toBeInTheDocument()
    expect(screen.getByText(/choose another filter/i)).toBeInTheDocument()
  })
})
