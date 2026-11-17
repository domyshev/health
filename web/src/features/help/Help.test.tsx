import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { Help } from './Help'

vi.mock('../../api/client', () => ({ apiRequest: vi.fn() }))
import { apiRequest } from '../../api/client'

afterEach(() => { vi.clearAllMocks(); sessionStorage.clear() })

it('saves a selected sweet and optional calories', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ id: '1', note: 'saved', createdAt: '2026-11-13T00:00:00Z' })
  const user = userEvent.setup()
  render(<Help userId="user-1" statisticsOpen={false} onCloseStatistics={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /help me/i }))
  expect(screen.queryByLabelText('Calories (optional)')).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'Choose a sweet' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /i want to eat something sweet/i }))
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  for (const name of ['Candy', 'Wafer', 'Snickers', 'Ice cream', 'Gummy candy', 'Condensed milk']) expect(screen.getByRole('button', { name })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Snickers' }))
  await user.type(screen.getByLabelText('Calories (optional)'), '250')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(apiRequest).toHaveBeenCalledWith('/v1/help-notes', { method: 'POST', body: JSON.stringify({ note: 'Wanted to eat: Snickers · 250 kcal' }) }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument())
})

it('restores the unfinished choice per user and clears it after saving', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ id: '1', note: 'saved', createdAt: '2026-11-13T00:00:00Z' })
  const user = userEvent.setup()
  const first = render(<Help userId="user-1" statisticsOpen={false} onCloseStatistics={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /help me/i }))
  await user.click(screen.getByRole('button', { name: /i want to eat something sweet/i }))
  await user.click(screen.getByRole('button', { name: 'Candy' }))
  await user.type(screen.getByLabelText('Calories (optional)'), '42')
  first.unmount()
  const second = render(<Help userId="user-1" statisticsOpen={false} onCloseStatistics={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /help me/i }))
  expect(screen.getByLabelText('Calories (optional)')).toHaveValue(42)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(sessionStorage.getItem('health:life-situations:user-1')).toBeNull())
  second.unmount()
  render(<Help userId="user-2" statisticsOpen={false} onCloseStatistics={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /help me/i }))
  expect(screen.getByRole('button', { name: /i want to eat something sweet/i })).toBeInTheDocument()
})
