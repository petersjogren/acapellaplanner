import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyProject,
  type Phrase,
  type Project,
  type Take,
  type VoicePart,
} from '../../domain/schemas.ts'
import { TakeReview } from './TakeReview.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function part(overrides: Partial<VoicePart> & { id: string }): VoicePart {
  return {
    name: overrides.name ?? overrides.id,
    shortLabel: overrides.shortLabel ?? overrides.id,
    color: '#c23b2a',
    targetTakes: 4,
    ...overrides,
  }
}

function phrase(overrides: Partial<Phrase> & { id: string }): Phrase {
  return {
    name: overrides.name ?? overrides.id,
    startMs: 0,
    endMs: 1000,
    partPlan: [],
    loopDefault: { mode: 'phrase-loop', gapMs: 400 },
    postRollMs: 0,
    ...overrides,
  }
}

function take(
  overrides: Partial<Take> & { id: string; phraseId: string; voicePartId: string },
): Take {
  return {
    takeIndex: 1,
    audioBlobId: 'blob-1',
    recordedAt: '2026-09-12T10:00:00.000Z',
    durationMs: 1000,
    headphoneMixSnapshot: { layers: [] },
    peakDb: -6,
    ...overrides,
  }
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    ...createEmptyProject('When I Fall'),
    voiceRoster: [part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' })],
    phrases: [phrase({ id: 'p1', name: 'when I fall' })],
    takes: [take({ id: 't1', phraseId: 'p1', voicePartId: 's1', takeIndex: 1 })],
    ...overrides,
  }
}

describe('TakeReview', () => {
  it('click Keeper sets rating keeper', () => {
    const onRate = vi.fn()
    render(
      <TakeReview
        project={project()}
        onRate={onRate}
        onPlayTake={vi.fn()}
        onPlayAllKeepers={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Keeper' }))

    expect(onRate).toHaveBeenCalledTimes(1)
    expect(onRate).toHaveBeenCalledWith('t1', 'keeper')
  })

  it('click Scratch sets rating scratch', () => {
    const onRate = vi.fn()
    render(
      <TakeReview
        project={project()}
        onRate={onRate}
        onPlayTake={vi.fn()}
        onPlayAllKeepers={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Scratch' }))

    expect(onRate).toHaveBeenCalledWith('t1', 'scratch')
  })

  it('lists takes with separate "With ghost" and "Solo" play buttons', () => {
    const onPlayTake = vi.fn()
    render(
      <TakeReview
        project={project()}
        onRate={vi.fn()}
        onPlayTake={onPlayTake}
        onPlayAllKeepers={vi.fn()}
      />,
    )

    expect(screen.getByText(/S1/)).toBeTruthy()
    expect(screen.getAllByText(/when I fall/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'With ghost' }))
    expect(onPlayTake).toHaveBeenCalledWith('t1', 'ghost')

    fireEvent.click(screen.getByRole('button', { name: 'Solo (no ghost)' }))
    expect(onPlayTake).toHaveBeenCalledWith('t1', 'solo')
  })

  it('stops the active take mode instead of replaying it', () => {
    const onPlayTake = vi.fn()
    const onStop = vi.fn()
    render(
      <TakeReview
        project={project()}
        onRate={vi.fn()}
        onPlayTake={onPlayTake}
        onPlayAllKeepers={vi.fn()}
        onStop={onStop}
        playing={{ kind: 'take', takeId: 't1', mode: 'ghost' }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Stop — With ghost' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop — With ghost' }))

    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onPlayTake).not.toHaveBeenCalled()
  })

  it('offers both "All keepers" buttons at every scope, enabled when keepers exist', () => {
    const onPlayAllKeepers = vi.fn()
    const withKeeper = project({
      takes: [
        take({ id: 't1', phraseId: 'p1', voicePartId: 's1', takeIndex: 1, rating: 'keeper' }),
      ],
    })
    render(
      <TakeReview
        project={withKeeper}
        onRate={vi.fn()}
        onPlayTake={vi.fn()}
        onPlayAllKeepers={onPlayAllKeepers}
      />,
    )

    // "All phrases" is the default scope — the song-wide buttons show immediately.
    const noGhostSong = screen.getByRole('button', { name: 'All keepers (no ghost)' })
    const withGhostSong = screen.getByRole('button', { name: 'All keepers (with ghost)' })
    expect(noGhostSong.hasAttribute('disabled')).toBe(false)
    expect(withGhostSong.hasAttribute('disabled')).toBe(false)

    fireEvent.click(noGhostSong)
    expect(onPlayAllKeepers).toHaveBeenCalledWith(null, 'no-ghost')

    fireEvent.click(withGhostSong)
    expect(onPlayAllKeepers).toHaveBeenCalledWith(null, 'with-ghost')

    onPlayAllKeepers.mockClear()
    fireEvent.change(screen.getByLabelText('Phrase'), { target: { value: 'p1' } })
    fireEvent.click(screen.getByRole('button', { name: 'All keepers (no ghost)' }))
    expect(onPlayAllKeepers).toHaveBeenCalledWith('p1', 'no-ghost')
  })

  it('disables both "All keepers" buttons when the current scope has no keepers', () => {
    render(
      <TakeReview
        project={project()}
        onRate={vi.fn()}
        onPlayTake={vi.fn()}
        onPlayAllKeepers={vi.fn()}
      />,
    )

    // Default scope is "All phrases"; the sole take is unrated, not a keeper.
    expect(
      screen.getByRole('button', { name: 'All keepers (no ghost)' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByRole('button', { name: 'All keepers (with ghost)' }).hasAttribute('disabled'),
    ).toBe(true)

    fireEvent.change(screen.getByLabelText('Phrase'), { target: { value: 'p1' } })
    expect(
      screen.getByRole('button', { name: 'All keepers (no ghost)' }).hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByRole('button', { name: 'All keepers (with ghost)' }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('stops the active "All keepers" mode instead of replaying it', () => {
    const onPlayAllKeepers = vi.fn()
    const onStop = vi.fn()
    const withKeeper = project({
      takes: [
        take({ id: 't1', phraseId: 'p1', voicePartId: 's1', takeIndex: 1, rating: 'keeper' }),
      ],
    })
    render(
      <TakeReview
        project={withKeeper}
        onRate={vi.fn()}
        onPlayTake={vi.fn()}
        onPlayAllKeepers={onPlayAllKeepers}
        onStop={onStop}
        selectedPhraseId="p1"
        playing={{ kind: 'phrase', phraseId: 'p1', mode: 'no-ghost' }}
      />,
    )

    // Only the active mode shows Stop; the other mode is untouched.
    const stopButton = screen.getByRole('button', { name: 'Stop — All keepers (no ghost)' })
    expect(screen.getByRole('button', { name: 'All keepers (with ghost)' })).toBeTruthy()

    fireEvent.click(stopButton)

    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onPlayAllKeepers).not.toHaveBeenCalled()
  })
})
