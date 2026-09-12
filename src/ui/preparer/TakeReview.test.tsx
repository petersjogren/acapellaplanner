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
    sheetRefs: [],
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
        onPlay={vi.fn()}
        mixPresetId="ghost-focus"
        onMixChange={vi.fn()}
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
        onPlay={vi.fn()}
        mixPresetId="ghost-focus"
        onMixChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Scratch' }))

    expect(onRate).toHaveBeenCalledWith('t1', 'scratch')
  })

  it('lists takes and plays against ghost', () => {
    const onPlay = vi.fn()
    render(
      <TakeReview
        project={project()}
        onRate={vi.fn()}
        onPlay={onPlay}
        mixPresetId="ghost-focus"
        onMixChange={vi.fn()}
      />,
    )

    expect(screen.getByText(/S1/)).toBeTruthy()
    expect(screen.getAllByText(/when I fall/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(onPlay).toHaveBeenCalledWith('t1')
  })
})
