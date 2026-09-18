import { cleanup, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { PreparerShell } from './PreparerShell.tsx'

afterEach(() => {
  cleanup()
})

function renderShell(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('PreparerShell', () => {
  it('renders Prepare, Sing, and Review navigation', () => {
    renderShell(
      <PreparerShell>
        <p>Score desk</p>
      </PreparerShell>,
    )

    const nav = screen.getByRole('navigation', { name: 'Studio' })
    expect(nav).toBeTruthy()
    expect(screen.getByRole('link', { name: /Prepare/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Sing/ })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Review/ })).toBeTruthy()
  })

  it('renders the studio title and children', () => {
    renderShell(
      <PreparerShell title="Acapella Planner">
        <p>Mark phrases on the ghost</p>
      </PreparerShell>,
    )

    expect(screen.getByRole('heading', { name: 'Acapella Planner' })).toBeTruthy()
    expect(screen.getByText('Mark phrases on the ghost')).toBeTruthy()
  })

  it('marks the current nav item with aria-current', () => {
    renderShell(
      <PreparerShell current="sing">
        <p>Booth</p>
      </PreparerShell>,
    )

    expect(screen.getByRole('link', { name: /Sing/ }).getAttribute('aria-current')).toBe(
      'page',
    )
    expect(screen.getByRole('link', { name: /Prepare/ }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: /Review/ }).getAttribute('aria-current')).toBeNull()
  })

  it('points studio nav at project paths when projectId is set', () => {
    renderShell(
      <PreparerShell projectId="song-1">
        <p>Score desk</p>
      </PreparerShell>,
    )

    expect(screen.getByRole('link', { name: /Prepare/ }).getAttribute('href')).toBe(
      '/project/song-1/prepare',
    )
    expect(screen.getByRole('link', { name: /Sing/ }).getAttribute('href')).toBe(
      '/project/song-1/sing',
    )
    expect(screen.getByRole('link', { name: /Review/ }).getAttribute('href')).toBe(
      '/project/song-1/review',
    )
    expect(screen.getByRole('link', { name: 'Line up headphones' }).getAttribute('href')).toBe(
      '/calibrate',
    )
    expect(screen.getByRole('link', { name: 'Why this workflow' }).getAttribute('href')).toBe(
      '/workflow',
    )
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/')
  })
})
