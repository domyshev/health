import { render, screen, waitFor } from '@testing-library/react'
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page('Morning swim', 'next-page'))
      .mockResolvedValueOnce(page('Morning swim', 'next-page'))
      .mockResolvedValueOnce(page('Evening swim', ''))
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(<ActivitiesPage />, { wrapper: TestProviders })

    expect(await screen.findByText('Morning swim')).toBeInTheDocument()
    expect(screen.getAllByText(/420 kcal/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/pool · 1:40 \/100m/i).length).toBeGreaterThan(0)
    await user.click(screen.getByLabelText(/activity type/i))
    await user.click(screen.getByRole('option', { name: 'swimming' }))
    await user.click(screen.getByRole('button', { name: /load more/i }))

    expect(await screen.findByText('Evening swim')).toBeInTheDocument()
    expect(screen.getByText('Morning swim')).toBeInTheDocument()
    await waitFor(() => {
      expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('cursor=next-page')
    })
  })
})
