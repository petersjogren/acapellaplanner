import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Phrase } from '../../domain/schemas.ts'
import { PhraseStage } from './PhraseStage.tsx'

afterEach(() => {
  cleanup()
})

function phrase(overrides: Partial<Phrase> = {}): Phrase {
  return {
    id: 'p1',
    name: 'Verse',
    startMs: 0,
    endMs: 8400,
    partPlan: [],
    loopDefault: { mode: 'phrase-loop', gapMs: 400 },
    postRollMs: 0,
    ...overrides,
  }
}

function stageParagraphs() {
  return within(screen.getByRole('region', { name: 'Current phrase' })).getAllByRole('paragraph')
}

describe('PhraseStage', () => {
  it('shows phrase length under the song-position counter', () => {
    render(<PhraseStage phrase={phrase()} phraseIndex={2} phraseCount={5} />)

    const counter = screen.getByText('Phrase 2 of 5')
    const length = screen.getByText('8.4 s')
    const bigLine = screen.getByText('Verse')

    expect(counter.compareDocumentPosition(length) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(length.compareDocumentPosition(bigLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByText('Phrase Verse of 5')).toBeNull()
  })

  it('shows the trimmed lyric as the big line when there is one', () => {
    render(
      <PhraseStage
        phrase={phrase({ name: 'Verse', lyricText: '  when I fall in love  ' })}
        phraseIndex={1}
        phraseCount={2}
      />,
    )

    expect(screen.getByText('when I fall in love').textContent).toBe('when I fall in love')
    expect(screen.queryByText('Verse')).toBeNull()
    expect(screen.getByText('Phrase 1 of 2')).toBeTruthy()
  })

  it('shows the trimmed phrase name when the lyric is empty or whitespace', () => {
    const { rerender } = render(
      <PhraseStage phrase={phrase({ name: '  Verse  ', lyricText: '   ' })} phraseIndex={3} phraseCount={7} />,
    )

    expect(screen.getByText('Verse').textContent).toBe('Verse')
    expect(screen.getByText('Phrase 3 of 7')).toBeTruthy()

    rerender(
      <PhraseStage phrase={phrase({ name: 'Bridge', lyricText: undefined })} phraseIndex={3} phraseCount={7} />,
    )

    expect(screen.getByText('Bridge').textContent).toBe('Bridge')
    expect(screen.queryByText('Verse')).toBeNull()
  })

  it('leaves the big line blank for an unnamed phrase with no lyric', () => {
    render(
      <PhraseStage
        phrase={phrase({ name: '   ', lyricText: '  ', startMs: 30_000, endMs: 38_400 })}
        phraseIndex={4}
        phraseCount={6}
      />,
    )

    const [, , bigLine] = stageParagraphs()
    expect(bigLine?.textContent).toBe('')
    expect(screen.getByText('8.4 s')).toBeTruthy()
    expect(screen.getByText('Phrase 4 of 6')).toBeTruthy()
    expect(screen.queryByText('0:30.0')).toBeNull()
  })

  it('follows the phrase on stage', () => {
    const { rerender } = render(
      <PhraseStage phrase={phrase({ startMs: 0, endMs: 8400 })} phraseIndex={1} phraseCount={2} />,
    )
    expect(screen.getByText('8.4 s')).toBeTruthy()

    rerender(
      <PhraseStage
        phrase={phrase({ id: 'p2', name: 'Chorus', startMs: 1000, endMs: 2500 })}
        phraseIndex={2}
        phraseCount={2}
      />,
    )

    expect(screen.getByText('1.5 s')).toBeTruthy()
    expect(screen.queryByText('8.4 s')).toBeNull()
    expect(screen.getByText('Phrase 2 of 2')).toBeTruthy()
    expect(screen.getByText('Chorus')).toBeTruthy()
  })
})
