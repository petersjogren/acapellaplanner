import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GhostTimeline } from './GhostTimeline.tsx'
import type { Phrase } from '../../domain/schemas.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

const phrase: Phrase = {
  id: 'phrase-1',
  name: 'Phrase 1',
  startMs: 200,
  endMs: 800,
  lyricText: 'when I fall',
  sheetRefs: [],
  partPlan: [],
  loopDefault: { mode: 'phrase-loop', gapMs: 400 },
  postRollMs: 0,
}

function mockTimelineRect(width = 1000) {
  const timeline = screen.getByLabelText('Ghost timeline')
  vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 80,
    width,
    height: 80,
    toJSON() {
      return {}
    },
  })
  return timeline
}

describe('GhostTimeline', () => {
  it('renders a duration ruler and Mark a phrase copy without a waveform buffer', () => {
    render(
      <GhostTimeline
        durationMs={83_400}
        phrases={[]}
        onMarkPhrase={() => undefined}
        onUpdatePhrase={() => undefined}
        onRemovePhrase={() => undefined}
      />,
    )

    expect(screen.getByLabelText('Ghost timeline')).toBeTruthy()
    expect(screen.getByText('Mark a phrase')).toBeTruthy()
    expect(screen.queryByText('Add region')).toBeNull()
    expect(screen.getByText('0:00.0')).toBeTruthy()
    expect(screen.getByText('1:23.4')).toBeTruthy()
  })

  it('creates a phrase from a pointer drag mapped across the ghost duration', () => {
    const onMarkPhrase = vi.fn()
    render(
      <GhostTimeline
        durationMs={10_000}
        phrases={[]}
        onMarkPhrase={onMarkPhrase}
        onUpdatePhrase={() => undefined}
        onRemovePhrase={() => undefined}
      />,
    )

    const timeline = mockTimelineRect(1000)
    fireEvent.pointerDown(timeline, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(timeline, { clientX: 400, pointerId: 1 })
    fireEvent.pointerUp(timeline, { clientX: 400, pointerId: 1 })

    expect(onMarkPhrase).toHaveBeenCalledTimes(1)
    expect(onMarkPhrase).toHaveBeenCalledWith(1000, 4000)
  })

  it('edits the selected phrase name', () => {
    const onUpdatePhrase = vi.fn()
    render(
      <GhostTimeline
        durationMs={10_000}
        phrases={[phrase]}
        onMarkPhrase={() => undefined}
        onUpdatePhrase={onUpdatePhrase}
        onRemovePhrase={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Phrase 1/ }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Intro' } })

    expect(onUpdatePhrase).toHaveBeenCalledWith('phrase-1', { name: 'Intro' })
  })
})
