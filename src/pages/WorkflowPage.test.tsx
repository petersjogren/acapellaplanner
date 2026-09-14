import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkflowPage } from './WorkflowPage.tsx'

afterEach(() => {
  cleanup()
})

describe('WorkflowPage', () => {
  it('renders the Singers Unlimited workflow doc as formatted headings and text', () => {
    render(
      <MemoryRouter>
        <WorkflowPage />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('heading', { name: /Singers Unlimited workflow/i, level: 1 }),
    ).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'How they stacked', level: 2 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'How this app maps', level: 2 })).toBeTruthy()
    expect(screen.getByText(/Bonnie Herman.s ghost/)).toBeTruthy()
  })

  it('links back home', () => {
    render(
      <MemoryRouter>
        <WorkflowPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '← Home' }).getAttribute('href')).toBe('/')
  })

  it('renders the rubato vs in-time table', () => {
    render(
      <MemoryRouter>
        <WorkflowPage />
      </MemoryRouter>,
    )

    const table = screen.getByRole('table')
    expect(table).toBeTruthy()
    expect(screen.getAllByText('Follow the ghost').length).toBeGreaterThan(0)
    expect(screen.getAllByText('In time').length).toBeGreaterThan(0)
  })
})
