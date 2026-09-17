import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GhostTimeline,
  isTimelineClick,
  msAtTimelineX,
  phraseAtMs,
  phraseOverlayClass,
  timelineCursor,
} from './GhostTimeline.tsx'
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
  const onPlayPhrase = overrides.onPlayPhrase
  render(
    <GhostTimeline
      durationMs={10_000}
      phrases={[]}
      onMarkPhrase={onMarkPhrase}
      onUpdatePhrase={onUpdatePhrase}
      onRemovePhrase={onRemovePhrase}
      onSelectPhrase={onSelectPhrase}
      onPlayPhrase={onPlayPhrase}
      {...overrides}
    />,
  )
  return { onMarkPhrase, onUpdatePhrase, onRemovePhrase, onSelectPhrase, onPlayPhrase }
}

describe('phraseOverlayClass', () => {
  it('alternates gold then bronze by timeline index', () => {
    expect(phraseOverlayClass(0)).toBe('bg-phrase-overlay')
    expect(phraseOverlayClass(1)).toBe('bg-phrase-overlay-alt')
    expect(phraseOverlayClass(2)).toBe('bg-phrase-overlay')
  })
})

describe('phraseAtMs', () => {
  it('returns the phrase covering the time, preferring the later one on a shared boundary', () => {
    const first = { ...phrase, id: 'a', startMs: 200, endMs: 800 }
    const second = { ...phrase, id: 'b', startMs: 800, endMs: 1400 }
    expect(phraseAtMs(200, [first, second])?.id).toBe('a')
    expect(phraseAtMs(500, [first, second])?.id).toBe('a')
    expect(phraseAtMs(800, [first, second])?.id).toBe('b')
    expect(phraseAtMs(1400, [first, second])?.id).toBe('b')
    expect(phraseAtMs(100, [first, second])).toBeNull()
  })
})

describe('isTimelineClick', () => {
  it('treats sub-threshold pointer travel as a click', () => {
    expect(isTimelineClick({ clientX: 50, clientY: 10 }, { clientX: 54, clientY: 12 })).toBe(true)
    expect(isTimelineClick({ clientX: 50, clientY: 10 }, { clientX: 70, clientY: 10 })).toBe(false)
  })
})

describe('timelineCursor', () => {
  it('keeps the mark cursor on unused space and while dragging', () => {
    expect(timelineCursor({ hoveringPhrase: false, optionDown: false, dragging: false })).toBe(
      'mark',
    )
    expect(timelineCursor({ hoveringPhrase: true, optionDown: true, dragging: true })).toBe('mark')
  })

  it('uses select on a phrase and play when Option is down', () => {
    expect(timelineCursor({ hoveringPhrase: true, optionDown: false, dragging: false })).toBe(
      'select',
    )
    expect(timelineCursor({ hoveringPhrase: true, optionDown: true, dragging: false })).toBe('play')
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
    expect(screen.getByText('Option-click a phrase to play it.')).toBeTruthy()
    expect(screen.queryByText('Add region')).toBeNull()
    expect(screen.getByText('0:00.0')).toBeTruthy()
    expect(screen.getByText('1:23.4')).toBeTruthy()
  })

  it('renders a playhead at the given ghost time', () => {
    renderTimeline({ durationMs: 10_000, playheadMs: 2500 })

    expect(screen.getByTestId('ghost-playhead').style.left).toBe('25%')
  })

  it('renders an open mark-along preview', () => {
    renderTimeline({ durationMs: 10_000, openPreview: { startMs: 1000, endMs: 4000 } })

    const preview = screen.getByTestId('mark-along-preview')
    expect(preview.style.left).toBe('10%')
    expect(preview.style.width).toBe('30%')
  })

  it('omits playhead and open preview when unset', () => {
    renderTimeline()

    expect(screen.queryByTestId('ghost-playhead')).toBeNull()
    expect(screen.queryByTestId('mark-along-preview')).toBeNull()
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

  it('selects a phrase from a click on its waveform region', () => {
    const onSelectPhrase = vi.fn()
    const { onMarkPhrase } = renderTimeline({ phrases: [phrase], onSelectPhrase })

    const timeline = mockTimelineRect(1000)
    fireEvent.pointerDown(timeline, { clientX: 50, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(timeline, { clientX: 52, clientY: 11, pointerId: 1 })

    expect(onSelectPhrase).toHaveBeenCalledWith('phrase-1')
    expect(onMarkPhrase).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Name')).toBeTruthy()
  })

  it('does not select from a click on unused waveform space', () => {
    const onSelectPhrase = vi.fn()
    const { onMarkPhrase } = renderTimeline({ phrases: [phrase], onSelectPhrase })

    const timeline = mockTimelineRect(1000)
    fireEvent.pointerDown(timeline, { clientX: 900, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(timeline, { clientX: 900, clientY: 10, pointerId: 1 })

    expect(onSelectPhrase).not.toHaveBeenCalled()
    expect(onMarkPhrase).not.toHaveBeenCalled()
  })

  it('creates a phrase filling the gap on double-click of unused space', () => {
    const existing = { ...phrase, startMs: 2000, endMs: 3000 }
    const { onMarkPhrase } = renderTimeline({ phrases: [existing] })

    const timeline = mockTimelineRect(1000)
    fireEvent.dblClick(timeline, { clientX: 500, clientY: 10 })

    expect(onMarkPhrase).toHaveBeenCalledTimes(1)
    expect(onMarkPhrase).toHaveBeenCalledWith(3000, 10_000)
  })

  it('fills [0, duration] on double-click when no phrases exist', () => {
    const { onMarkPhrase } = renderTimeline()

    const timeline = mockTimelineRect(1000)
    fireEvent.dblClick(timeline, { clientX: 400, clientY: 10 })

    expect(onMarkPhrase).toHaveBeenCalledWith(0, 10_000)
  })

  it('does not create from a double-click on an existing phrase', () => {
    const onSelectPhrase = vi.fn()
    const { onMarkPhrase } = renderTimeline({ phrases: [phrase], onSelectPhrase })

    const timeline = mockTimelineRect(1000)
    fireEvent.dblClick(timeline, { clientX: 50, clientY: 10 })

    expect(onMarkPhrase).not.toHaveBeenCalled()
  })

  it('plays a phrase from an Option-click on its waveform region', () => {
    const onSelectPhrase = vi.fn()
    const onPlayPhrase = vi.fn()
    const { onMarkPhrase } = renderTimeline({ phrases: [phrase], onSelectPhrase, onPlayPhrase })

    const timeline = mockTimelineRect(1000)
    fireEvent.pointerDown(timeline, { clientX: 50, clientY: 10, pointerId: 1, altKey: true })
    fireEvent.pointerUp(timeline, { clientX: 50, clientY: 10, pointerId: 1, altKey: true })

    expect(onSelectPhrase).toHaveBeenCalledWith('phrase-1')
    expect(onPlayPhrase).toHaveBeenCalledWith('phrase-1')
    expect(onMarkPhrase).not.toHaveBeenCalled()
  })

  it('does not play from an Option-click on unused waveform space', () => {
    const onPlayPhrase = vi.fn()
    renderTimeline({ phrases: [phrase], onPlayPhrase })

    const timeline = mockTimelineRect(1000)
    fireEvent.pointerDown(timeline, { clientX: 900, clientY: 10, pointerId: 1, altKey: true })
    fireEvent.pointerUp(timeline, { clientX: 900, clientY: 10, pointerId: 1, altKey: true })

    expect(onPlayPhrase).not.toHaveBeenCalled()
  })

  it('still marks a phrase when a drag starts on an existing region', () => {
    const onSelectPhrase = vi.fn()
    const onPlayPhrase = vi.fn()
    const { onMarkPhrase } = renderTimeline({ phrases: [phrase], onSelectPhrase, onPlayPhrase })

    const timeline = mockTimelineRect(1000)
    fireEvent.pointerDown(timeline, { clientX: 50, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(timeline, { clientX: 400, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(timeline, { clientX: 400, clientY: 10, pointerId: 1 })

    expect(onMarkPhrase).toHaveBeenCalledWith(500, 4000)
    expect(onSelectPhrase).not.toHaveBeenCalled()
    expect(onPlayPhrase).not.toHaveBeenCalled()
  })

  it('switches the timeline cursor from mark to select to play', () => {
    renderTimeline({ phrases: [phrase] })
    const timeline = mockTimelineRect(1000)

    expect(timeline.getAttribute('data-cursor')).toBe('mark')
    expect(timeline.classList.contains('cursor-ew-resize')).toBe(true)

    fireEvent.pointerMove(timeline, { clientX: 50, clientY: 10 })
    expect(timeline.getAttribute('data-cursor')).toBe('select')
    expect(timeline.classList.contains('cursor-phrase-select')).toBe(true)

    fireEvent.keyDown(window, { key: 'Alt', altKey: true })
    expect(timeline.getAttribute('data-cursor')).toBe('play')
    expect(timeline.classList.contains('cursor-phrase-play')).toBe(true)

    fireEvent.keyUp(window, { key: 'Alt', altKey: false })
    expect(timeline.getAttribute('data-cursor')).toBe('select')

    fireEvent.pointerMove(timeline, { clientX: 900, clientY: 10 })
    expect(timeline.getAttribute('data-cursor')).toBe('mark')
  })
})
