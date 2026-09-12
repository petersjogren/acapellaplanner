import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SingerShell } from './SingerShell.tsx'

afterEach(() => {
  cleanup()
})

describe('SingerShell', () => {
  it('renders a minimal top bar with song title and part label', () => {
    render(
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
    render(
      <SingerShell songTitle="Ghost lead" partLabel="Soprano 1">
        <p>The booth is quiet</p>
      </SingerShell>,
    )

    expect(screen.getByText('The booth is quiet')).toBeTruthy()
  })
})
