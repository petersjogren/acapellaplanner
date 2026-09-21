import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BoothLayout } from './BoothLayout.tsx'

afterEach(() => {
  cleanup()
})

describe('BoothLayout', () => {
  it('keeps the dock after the film stage', () => {
    render(
      <BoothLayout dock={<button type="button">Record</button>}>
        <p>Or I'll never fall in love</p>
      </BoothLayout>,
    )

    const lyric = screen.getByText(/never fall in love/)
    const record = screen.getByRole('button', { name: 'Record' })
    expect(lyric.compareDocumentPosition(record) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
