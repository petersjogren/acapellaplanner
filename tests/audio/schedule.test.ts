import { describe, expect, it } from 'vitest'
import {
  computeLoopDeadlines,
  computePlayWindow,
  phraseEnterDelayMs,
  type PhrasePlaySpec,
} from '../../src/audio/schedule.ts'

function spec(overrides: Partial<PhrasePlaySpec> = {}): PhrasePlaySpec {
  return {
    startMs: 1000,
    endMs: 3000,
    preRollMs: 250,
    postRollMs: 100,
    gapMs: 400,
    loop: false,
    ...overrides,
  }
}

describe('computePlayWindow', () => {
  it('starts pre-roll before the phrase and extends post-roll after it', () => {
    expect(computePlayWindow(spec(), 10_000)).toEqual({
      offsetMs: 750,
      durationMs: 2350,
      requestedDurationMs: 2350,
    })
  })

  it('clamps pre-roll to the start of the ghost', () => {
    expect(
      computePlayWindow(
        spec({ startMs: 100, endMs: 800, preRollMs: 500, postRollMs: 0 }),
        10_000,
      ),
    ).toEqual({ offsetMs: 0, durationMs: 800, requestedDurationMs: 800 })
  })

  it('clamps a 2000 ms head start when the phrase starts at 0 and keeps the tail', () => {
    expect(
      computePlayWindow(
        spec({ startMs: 0, endMs: 3000, preRollMs: 2000, postRollMs: 2000 }),
        10_000,
      ),
    ).toEqual({ offsetMs: 0, durationMs: 5000, requestedDurationMs: 5000 })
  })

  it('clamps post-roll to the ghost duration', () => {
    expect(
      computePlayWindow(
        spec({ startMs: 9000, endMs: 9800, preRollMs: 0, postRollMs: 500 }),
        10_000,
      ),
    ).toEqual({ offsetMs: 9000, durationMs: 1000, requestedDurationMs: 1300 })
  })

  // Regression: the ghost audio being shorter than the phrase used to silently
  // shorten the whole pass, truncating both recording and listen-back.
  it('reports the requested span separately when the ghost audio runs out early', () => {
    expect(
      computePlayWindow(spec({ startMs: 0, endMs: 10_000, preRollMs: 0, postRollMs: 0 }), 2_500),
    ).toEqual({ offsetMs: 0, durationMs: 2_500, requestedDurationMs: 10_000 })
  })

  it('throws a clear error when the window duration is zero', () => {
    expect(() =>
      computePlayWindow(spec({ startMs: 0, endMs: 100, preRollMs: 0, postRollMs: 0 }), 0),
    ).toThrow(/play window duration must be greater than 0/i)
  })

  it('throws a clear error when the phrase sits past the ghost duration', () => {
    expect(() =>
      computePlayWindow(spec({ startMs: 5000, endMs: 6000, preRollMs: 0, postRollMs: 0 }), 4000),
    ).toThrow(/play window duration must be greater than 0/i)
  })

  it('throws a clear error for a negative duration', () => {
    expect(() =>
      computePlayWindow(spec({ startMs: 800, endMs: 200, preRollMs: 0, postRollMs: 0 }), 10_000),
    ).toThrow(/play window duration must be greater than 0/i)
  })
})

describe('computeLoopDeadlines', () => {
  it('spaces BufferSource starts by window duration plus gap', () => {
    // window 2000ms, gap 400ms, audioNow t=1 → 1, 3.4, 5.8
    expect(computeLoopDeadlines({ offsetMs: 0, durationMs: 2000 }, 400, 1, 3)).toEqual([
      1, 3.4, 5.8,
    ])
  })

  it('returns an empty list when count is 0', () => {
    expect(computeLoopDeadlines({ offsetMs: 100, durationMs: 2000 }, 400, 1, 0)).toEqual([])
  })

  it('throws when count is negative', () => {
    expect(() => computeLoopDeadlines({ offsetMs: 0, durationMs: 2000 }, 400, 1, -1)).toThrow(
      /count must be non-negative/i,
    )
  })

  it('throws when gap is negative', () => {
    expect(() => computeLoopDeadlines({ offsetMs: 0, durationMs: 2000 }, -1, 1, 2)).toThrow(
      /gap must be non-negative/i,
    )
  })
})

describe('phraseEnterDelayMs', () => {
  it('is the time from play start to phrase.startMs', () => {
    const play = computePlayWindow(spec({ startMs: 1000, preRollMs: 250 }), 10_000)
    expect(phraseEnterDelayMs(1000, play.offsetMs)).toBe(250)
  })

  it('is the remaining time to the phrase when pre-roll clamped to 0', () => {
    const play = computePlayWindow(
      spec({ startMs: 100, endMs: 800, preRollMs: 500, postRollMs: 0 }),
      10_000,
    )
    expect(play.offsetMs).toBe(0)
    expect(phraseEnterDelayMs(100, play.offsetMs)).toBe(100)
  })

  it('is 0 when the phrase itself starts at 0', () => {
    const play = computePlayWindow(
      spec({ startMs: 0, endMs: 3000, preRollMs: 2000, postRollMs: 2000 }),
      10_000,
    )
    expect(play.offsetMs).toBe(0)
    expect(phraseEnterDelayMs(0, play.offsetMs)).toBe(0)
  })
})
