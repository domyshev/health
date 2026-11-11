import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { TestProviders } from '../../test/TestProviders'
import { ActivityFieldSettings, useActivityFields } from './ActivityFieldSettings'

function Example() {
  const list = useActivityFields('cardio', 'list')
  const detail = useActivityFields('cardio', 'detail')
  return <>
    <div>List distance: {String(list.fields.includes('distanceM'))}</div>
    <div>Detail distance: {String(detail.fields.includes('distanceM'))}</div>
    <ActivityFieldSettings type="cardio" view="list" />
    <ActivityFieldSettings type="cardio" view="detail" />
  </>
}

afterEach(() => vi.unstubAllGlobals())

it('saves list settings independently of detail settings and restores them', async () => {
  const items: { type: string; view: string; fields: string[] }[] = []
  vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const value = JSON.parse(String(init.body)) as { type: string; view: string; fields: string[] }
      items.splice(0, items.length, value)
      return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify({ items }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const user = userEvent.setup()
  const first = render(<Example />, { wrapper: TestProviders })
  expect(await screen.findByText('List distance: false')).toBeInTheDocument()
  expect(screen.getByText('Detail distance: false')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /choose list fields for cardio/i }))
  const distance = await screen.findByRole('checkbox', { name: 'Distance' })
  await waitFor(() => expect(distance).toBeEnabled())
  await user.click(distance)
  await waitFor(() => expect(screen.getByText('List distance: true')).toBeInTheDocument())
  expect(screen.getByText('Detail distance: false')).toBeInTheDocument()
  first.unmount()
  render(<Example />, { wrapper: TestProviders })
  expect(await screen.findByText('List distance: true')).toBeInTheDocument()
  expect(screen.getByText('Detail distance: false')).toBeInTheDocument()
})
