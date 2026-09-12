import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CompletionMatrix } from './CompletionMatrix.tsx'
import { createEmptyProject, type Phrase, type Project, type Take, type VoicePart } from '../../domain/schemas.ts'

afterEach(() => {
  cleanup()
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
  return { ...createEmptyProject('When I Fall'), ...overrides }
}

describe('CompletionMatrix', () => {
  it('shows empty copy when there are no parts', () => {
    render(
      <CompletionMatrix
        project={project({ phrases: [phrase({ id: 'p1', name: 'when I fall' })] })}
      />,
    )
    expect(
      screen.getByText("Mark phrases and add voice parts to see what's left."),
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shows empty copy when there are no phrases', () => {
    render(
      <CompletionMatrix
        project={project({ voiceRoster: [part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' })] })}
      />,
    )
    expect(
      screen.getByText("Mark phrases and add voice parts to see what's left."),
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('renders parts as rows, phrases as columns, with take counts and keeper indication', () => {
    render(
      <CompletionMatrix
        project={project({
          voiceRoster: [
            part({ id: 's1', name: 'Soprano 1', shortLabel: 'S1' }),
            part({ id: 'a1', name: 'Alto 1', shortLabel: 'A1' }),
          ],
          phrases: [
            phrase({ id: 'p1', name: 'when I fall' }),
            phrase({ id: 'p2', name: 'hold on' }),
          ],
          takes: [
            take({ id: 't1', phraseId: 'p1', voicePartId: 's1', takeIndex: 1, rating: 'keeper' }),
            take({ id: 't2', phraseId: 'p1', voicePartId: 's1', takeIndex: 2 }),
          ],
        })}
      />,
    )

    expect(screen.getByRole('columnheader', { name: 'when I fall' })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: 'hold on' })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: /Soprano 1/ })).toBeTruthy()
    expect(screen.getByRole('rowheader', { name: /Alto 1/ })).toBeTruthy()
    expect(screen.getByText('2/4')).toBeTruthy()
    expect(screen.getAllByText('0/4').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('1 keeper')).toBeTruthy()
  })
})
