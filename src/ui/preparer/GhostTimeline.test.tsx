import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GhostTimeline, msAtTimelineX, phraseOverlayClass } from './GhostTimeline.tsx'
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

function renderTimeline(overrides: Partial<ComponentProps<typeof GhostTimeline>> = {}) {
  const onMarkPhrase = overrides.onMarkPhrase ?? vi.fn()
  const onUpdatePhrase = overrides.onUpdatePhrase ?? vi.fn()
  const onRemovePhrase = overrides.onRemovePhrase ?? vi.fn()
  const onSelectPhrase = overrides.onSelectPhrase
  render(
    <GhostTimeline
      durationMs={overrides.durationMs ?? 10_000}
      phrases={overrides.phrases ?? []}
      onMarkPhrase={onMarkPhrase}
      onUpdatePhrase={onUpdatePhrase}
      onRemovePhrase={onRemovePhrase}
      onSelectPhrase={onSelectPhrase}
    />,
  )
  return { onMarkPhrase, onUpdatePhrase, onRemovePhrase, onSelectPhrase }
}

describe('phraseOverlayClass', () => {
  it('alternates gold then bronze by timeline index', () => {
    expect(phraseOverlayClass(0)).toBe('bg-phrase-overlay')
    expect(phraseOverlayClass(1)).toBe('bg-phrase-overlay-alt')
    expect(phraseOverlayClass(2)).toBe('bg-phrase-overlay')
  })
})

describe('msAtTimelineX', () => {
  const rect = { left: 0, width: 1000 }

  it('maps clientX across the ghost duration', () => {
    expect(msAtTimelineX(100, rect, 10_000)).toBe(1000)
    expect(msAtTimelineX(400, rect, 10_000)).toBe(4000)
  })

  it('clamps to [0, durationMs] and treats a zero-width track as 0', () => {
    expect(msAtTimelineX(-50, rect, 10_000)).toBe(0)
    expect(msAtTimelineX(2000, rect, 10_000)).toBe(10_000)
    expect(msAtTimelineX(50, { left: 0, width: 0 }, 10_000)).toBe(0)
  })
})

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
    const { onMarkPhrase } = renderTimeline()

    const timeline = mockTimelineRect(1000)
    fireEvent.pointerDown(timeline, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(timeline, { clientX: 400, pointerId: 1 })
    fireEvent.pointerUp(timeline, { clientX: 400, pointerId: 1 })

    expect(onMarkPhrase).toHaveBeenCalledTimes(1)
    expect(onMarkPhrase).toHaveBeenCalledWith(1000, 4000)
  })

  it('creates a correctly ordered phrase from a reverse drag', () => {
    const { onMarkPhrase } = renderTimeline()

    const timeline = mockTimelineRect(1000)
    fireEvent.pointerDown(timeline, { clientX: 400, pointerId: 1 })
    fireEvent.pointerMove(timeline, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(timeline, { clientX: 100, pointerId: 1 })

    expect(onMarkPhrase).toHaveBeenCalledTimes(1)
    expect(onMarkPhrase).toHaveBeenCalledWith(1000, 4000)
  })

  it('does not create a phrase from a too-short click', () => {
    const { onMarkPhrase } = renderTimeline()

    const timeline = mockTimelineRect(1000)
    fireEvent.pointerDown(timeline, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(timeline, { clientX: 100, pointerId: 1 })

    expect(onMarkPhrase).not.toHaveBeenCalled()
  })

  it('does not create a phrase from a drag shorter than 50ms', () => {
    const { onMarkPhrase } = renderTimeline()

    const timeline = mockTimelineRect(1000)
    fireEvent.pointerDown(timeline, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(timeline, { clientX: 104, pointerId: 1 })
    fireEvent.pointerUp(timeline, { clientX: 104, pointerId: 1 })

    expect(onMarkPhrase).not.toHaveBeenCalled()
  })

  it('surfaces overlap as role=alert', async () => {
    const onMarkPhrase = vi.fn(() =>
      Promise.reject(new Error('Phrases overlap on the ghost timeline')),
    )
    renderTimeline({ onMarkPhrase })

    const timeline = mockTimelineRect(1000)
    fireEvent.pointerDown(timeline, { clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(timeline, { clientX: 400, pointerId: 1 })
    fireEvent.pointerUp(timeline, { clientX: 400, pointerId: 1 })

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/overlap/i)
    })
  })

  it('tints neighbouring waveform overlays even/odd in timeline order', () => {
    const later: Phrase = { ...phrase, id: 'phrase-2', name: 'Phrase 2', startMs: 900, endMs: 1400 }
    const earlier: Phrase = { ...phrase, id: 'phrase-1', name: 'Phrase 1', startMs: 200, endMs: 800 }
    renderTimeline({ phrases: [later, earlier] })

    const first = document.querySelector('[data-phrase-overlay="phrase-1"]')
    const second = document.querySelector('[data-phrase-overlay="phrase-2"]')
    expect(first?.classList.contains('bg-phrase-overlay')).toBe(true)
    expect(first?.classList.contains('bg-phrase-overlay-alt')).toBe(false)
    expect(second?.classList.contains('bg-phrase-overlay-alt')).toBe(true)
  })

  it('commits the selected phrase name on blur', () => {
    const { onUpdatePhrase } = renderTimeline({ phrases: [phrase] })

    fireEvent.click(screen.getByRole('button', { name: /Phrase 1/ }))
    const input = screen.getByLabelText('Name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Intro' } })
    expect(onUpdatePhrase).not.toHaveBeenCalled()

    fireEvent.blur(input)
    expect(onUpdatePhrase).toHaveBeenCalledWith('phrase-1', { name: 'Intro' })
  })

  it('keeps an empty name draft without calling updatePhrase', () => {
    const { onUpdatePhrase } = renderTimeline({ phrases: [phrase] })

    fireEvent.click(screen.getByRole('button', { name: /Phrase 1/ }))
    const input = screen.getByLabelText('Name') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })

    expect(onUpdatePhrase).not.toHaveBeenCalled()
    expect(input.value).toBe('')

    fireEvent.blur(input)
    expect(onUpdatePhrase).not.toHaveBeenCalled()
    expect(input.value).toBe('Phrase 1')
  })

  it('notifies when a phrase is selected or cleared', () => {
    const onSelectPhrase = vi.fn()
    renderTimeline({ phrases: [phrase], onSelectPhrase })

    fireEvent.click(screen.getByRole('button', { name: /Phrase 1/ }))
    expect(onSelectPhrase).toHaveBeenCalledWith('phrase-1')

    fireEvent.click(screen.getByRole('button', { name: 'Delete phrase' }))
    expect(onSelectPhrase).toHaveBeenCalledWith(null)
  })

  it('updates head start (preRollMs) from the selected phrase editor', () => {
    const { onUpdatePhrase } = renderTimeline({ phrases: [phrase] })

    fireEvent.click(screen.getByRole('button', { name: /Phrase 1/ }))
    const input = screen.getByLabelText('Head start (ms)') as HTMLInputElement
    fireEvent.change(input, { target: { value: '300' } })

    expect(onUpdatePhrase).toHaveBeenCalledWith('phrase-1', { preRollMs: 300 })
  })

  it('updates crossfade tail (postRollMs) from the selected phrase editor', () => {
    const { onUpdatePhrase } = renderTimeline({ phrases: [phrase] })

    fireEvent.click(screen.getByRole('button', { name: /Phrase 1/ }))
    const input = screen.getByLabelText('Crossfade tail (ms)') as HTMLInputElement
    fireEvent.change(input, { target: { value: '500' } })

    expect(onUpdatePhrase).toHaveBeenCalledWith('phrase-1', { postRollMs: 500 })
  })
})
