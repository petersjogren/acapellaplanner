import { cleanup, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SingerShell } from './SingerShell.tsx'

afterEach(() => {
  cleanup()
})

function renderShell(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('SingerShell', () => {
  it('renders a minimal top bar with song title and part label', () => {
    renderShell(
      <SingerShell songTitle="When I Fall in Love" partLabel="Alto 2">
        <p>Breathe, then sing</p>
      </SingerShell>,
    )

    const banner = screen.getByRole('banner')
    expect(banner).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'When I Fall in Love' })).toBeTruthy()
    expect(screen.getByText(/You are singing/)).toBeTruthy()
    expect(screen.getByText('Alto 2')).toBeTruthy()
  })

  it('renders children in the booth content area', () => {
    renderShell(
      <SingerShell songTitle="Ghost lead" partLabel="Soprano 1">
        <p>The booth is quiet</p>
      </SingerShell>,
    )

    expect(screen.getByText('The booth is quiet')).toBeTruthy()
  })

  it('links back home', () => {
    renderShell(
      <SingerShell songTitle="When I Fall in Love">
        <p>Booth</p>
      </SingerShell>,
    )

    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/')
  })

  it('links to headphone lineup', () => {
    renderShell(
      <SingerShell songTitle="When I Fall in Love">
        <p>Booth</p>
      </SingerShell>,
    )

    expect(screen.getByRole('link', { name: 'Line up headphones' }).getAttribute('href')).toBe(
      '/calibrate',
    )
  })
})
