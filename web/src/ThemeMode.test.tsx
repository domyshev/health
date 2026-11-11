import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
import { ThemeModeProvider, useThemeMode } from './ThemeMode'

function Example() {
  const { mode, setMode } = useThemeMode()
  return <><span>{mode}</span><button onClick={() => setMode('light')}>Light</button><button onClick={() => setMode('system')}>System</button></>
}

afterEach(() => localStorage.removeItem('health:theme'))

it('stores the selected theme and restores it on the next visit', async () => {
  localStorage.removeItem('health:theme')
  const user = userEvent.setup()
  const first = render(<ThemeModeProvider><Example /></ThemeModeProvider>)
  await user.click(screen.getByRole('button', { name: 'Light' }))
  expect(localStorage.getItem('health:theme')).toBe('light')
  first.unmount()
  render(<ThemeModeProvider><Example /></ThemeModeProvider>)
  expect(screen.getByText('light')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'System' }))
  expect(localStorage.getItem('health:theme')).toBe('system')
})
