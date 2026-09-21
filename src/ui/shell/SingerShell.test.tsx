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
    expect(banner.parentElement?.className).toMatch(/\bh-dvh\b/)
  })

  it('links the song title back to Prepare when a project is loaded', () => {
    renderShell(
      <SingerShell songTitle="When I Fall in Love" projectId="song-1">
        <p>Booth</p>
      </SingerShell>,
    )

    expect(screen.getByRole('link', { name: 'When I Fall in Love' }).getAttribute('href')).toBe(
      '/project/song-1/prepare',
    )
  })

  it('renders the title as plain text with no project loaded', () => {
    renderShell(
      <SingerShell songTitle="When I Fall in Love">
        <p>Booth</p>
      </SingerShell>,
    )

    expect(screen.getByRole('heading', { name: 'When I Fall in Love' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'When I Fall in Love' })).toBeNull()
  })

  it('renders children in the booth content area', () => {
    renderShell(
      <SingerShell songTitle="Ghost lead" partLabel="Soprano 1">
        <p>The booth is quiet</p>
      </SingerShell>,
    )

    expect(screen.getByText('The booth is quiet')).toBeTruthy()
  })

  it('links to Sing and Play when a project is loaded', () => {
    renderShell(
      <SingerShell songTitle="When I Fall in Love" projectId="song-1" current="play">
        <p>Follow the sheet</p>
      </SingerShell>,
    )

    expect(screen.getByRole('link', { name: 'Sing' }).getAttribute('href')).toBe(
      '/project/song-1/sing',
    )
    expect(screen.getByRole('link', { name: 'Play' }).getAttribute('href')).toBe(
      '/project/song-1/play',
    )
    expect(screen.getByRole('link', { name: 'Play' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Sing' }).getAttribute('aria-current')).toBeNull()
  })

  it('does not link Sing or Play without a project', () => {
    renderShell(
      <SingerShell songTitle="When I Fall in Love">
        <p>Booth</p>
      </SingerShell>,
    )

    expect(screen.queryByRole('link', { name: 'Sing' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Play' })).toBeNull()
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

  it('links to the Singers Unlimited workflow explainer', () => {
    renderShell(
      <SingerShell songTitle="When I Fall in Love">
        <p>Booth</p>
      </SingerShell>,
    )

    expect(screen.getByRole('link', { name: 'Why this workflow' }).getAttribute('href')).toBe(
      '/workflow',
    )
  })
})
