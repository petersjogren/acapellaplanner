import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PreparerShell } from './PreparerShell.tsx'

afterEach(() => {
  cleanup()
})

describe('PreparerShell', () => {
  it('renders Prepare, Sing, and Review navigation', () => {
    render(
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
    render(
      <PreparerShell title="Acapella Planner">
        <p>Mark phrases on the ghost</p>
      </PreparerShell>,
    )

    expect(screen.getByRole('heading', { name: 'Acapella Planner' })).toBeTruthy()
    expect(screen.getByText('Mark phrases on the ghost')).toBeTruthy()
  })
})
