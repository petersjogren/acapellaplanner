import { describe, expect, it } from 'vitest'
import { createEmptyProject, type Phrase, type Take, type VoicePart } from '../../src/domain/schemas.ts'
import {
  assignLanes,
  bindDecodedDuration,
  LANE_FADE_MS,
  LANE_MIN_GAP_MS,
  laneLetter,
  lanePath,
  planSegments,
  renderLanePcm,
  safeSegment,
  segmentStartMs,
  stemPath,
  type ExportLane,
  type PlannedSegment,
} from '../../src/storage/dawExport.ts'
import { msToSamples } from '../../src/storage/wav.ts'

function samplePhrase(overrides: Partial<Phrase> = {}): Phrase {
  return {
    id: 'p1',
    name: 'Phrase 1',
    startMs: 0,
    endMs: 5000,
    sheetRefs: [],
    partPlan: [],
    loopDefault: { mode: 'once', gapMs: 0 },
    postRollMs: 0,
    preRollMs: 250,
    ...overrides,
  }
}

function samplePart(overrides: Partial<VoicePart> = {}): VoicePart {
  return {
    id: 'bass',
    name: 'Bass',
    shortLabel: 'B',
    color: '#000',
    targetTakes: 1,
    ...overrides,
  }
}

function sampleTake(overrides: Partial<Take> = {}): Take {
  return {
    id: 't1',
    phraseId: 'p1',
    voicePartId: 'bass',
    takeIndex: 1,
    audioBlobId: 'blob-1',
    recordedAt: '2026-09-12T10:00:00.000Z',
    durationMs: 4000,
    headphoneMixSnapshot: { layers: [] },
    peakDb: 0,
    ...overrides,
  }
}

const phrases = [
  samplePhrase({ id: 'p1', name: 'Phrase 1', startMs: 0, endMs: 5000, preRollMs: 250 }),
  samplePhrase({ id: 'p2', name: 'Phrase 2', startMs: 10000, endMs: 15000, preRollMs: 250 }),
]
const bass = samplePart()
const project = {
  ...createEmptyProject('Song'),
  phrases,
  voiceRoster: [bass],
  takes: [
    sampleTake({ id: 'take-p1', phraseId: 'p1', takeIndex: 1, audioBlobId: 'blob-p1', rating: 'keeper' }),
    sampleTake({ id: 'take-p2', phraseId: 'p2', takeIndex: 1, audioBlobId: 'blob-p2', rating: 'keeper' }),
    sampleTake({
      id: 'take-late',
      phraseId: 'p2',
      takeIndex: 2,
      audioBlobId: 'blob-late',
      latencyCompMs: 87,
    }),
    sampleTake({ id: 'take-unrated', phraseId: 'p1', takeIndex: 2, audioBlobId: 'blob-unrated' }),
  ],
}

const noPreRollPhrase: Phrase = {
  id: 'p2',
  name: 'Phrase 2',
  startMs: 10000,
  endMs: 15000,
  sheetRefs: [],
  partPlan: [],
  loopDefault: { mode: 'once', gapMs: 0 },
  postRollMs: 0,
}
const noPreRollProject = {
  ...createEmptyProject('Song'),
  phrases: [noPreRollPhrase],
  voiceRoster: [bass],
  takes: [sampleTake({ id: 'take-p2', phraseId: 'p2', takeIndex: 1, audioBlobId: 'blob-p2', rating: 'keeper' })],
}

const reversedArrayProject = {
  ...project,
  phrases: [...phrases].reverse(),
}

const orphanProject = {
  ...createEmptyProject('Song'),
  phrases: [],
  voiceRoster: [],
  takes: [sampleTake({ id: 'orphan', phraseId: 'gone', voicePartId: 'gone' })],
}

describe('safeSegment', () => {
  it('keeps letters, digits, dash and underscore', () => {
    expect(safeSegment('Bass 1')).toBe('Bass-1')
    expect(safeSegment('Sop/Alto')).toBe('Sop-Alto')
    expect(safeSegment('  Tenor  ')).toBe('Tenor')
    expect(safeSegment('Ångström')).toBe('Angstrom')
  })

  it('never returns an empty string', () => {
    expect(safeSegment('///')).toBe('part')
    expect(safeSegment('')).toBe('part')
  })
})

describe('laneLetter', () => {
  it('is A, B, C ... then falls back past Z', () => {
    expect(laneLetter(0)).toBe('A')
    expect(laneLetter(25)).toBe('Z')
    expect(laneLetter(26)).toBe('L27')
  })
})

describe('lanePath', () => {
  it('is <Part>/<Part>_<letter>.wav', () => {
    expect(lanePath('Bass', 0)).toBe('Bass/Bass_A.wav')
    expect(lanePath('Sop 1/2', 1)).toBe('Sop-1-2/Sop-1-2_B.wav')
  })
})

describe('stemPath', () => {
  it('is <Part>/<label>_p<phrase>_t<take>.wav', () => {
    expect(
      stemPath({ partName: 'Bass', shortLabel: 'B', phraseIndex: 1, takeIndex: 2 }),
    ).toBe('Bass/B_p1_t2.wav')
  })

  it('sanitises both the folder and the file', () => {
    expect(
      stemPath({ partName: 'Sop 1/2', shortLabel: 'S/1', phraseIndex: 10, takeIndex: 3 }),
    ).toBe('Sop-1-2/S-1_p10_t3.wav')
  })
})

describe('segmentStartMs', () => {
  it('clamps phrase 1 at start 0 with preRoll 250 to 0, not -250', () => {
    expect(segmentStartMs({ startMs: 0, preRollMs: 250 })).toBe(0)
  })

  it('places phrase 2 at 9750 (10000 - 250)', () => {
    expect(segmentStartMs({ startMs: 10000, preRollMs: 250 })).toBe(9750)
  })

  it('treats missing preRollMs as 0', () => {
    expect(segmentStartMs({ startMs: 10000 })).toBe(10000)
  })
})

describe('planSegments', () => {
  it('places a keeper on phrase 2 at timelineStartMs 9750 with trimLeadingMs 0', () => {
    const segments = planSegments(project, { keepersOnly: true })
    const p2 = segments.find((segment) => segment.takeId === 'take-p2')
    expect(p2).toMatchObject({
      takeId: 'take-p2',
      audioBlobId: 'blob-p2',
      voicePartId: 'bass',
      partName: 'Bass',
      shortLabel: 'B',
      phraseIndex: 2,
      phraseName: 'Phrase 2',
      takeIndex: 1,
      timelineStartMs: 9750,
      trimLeadingMs: 0,
      durationMs: 4000,
    })
  })

  it('clamps phrase 1 timelineStartMs to 0, not startMs and not -250', () => {
    const segments = planSegments(project, { keepersOnly: true })
    const p1 = segments.find((segment) => segment.takeId === 'take-p1')
    expect(p1?.timelineStartMs).toBe(0)
    expect(p1?.timelineStartMs).not.toBe(-250)
    expect(p1?.phraseIndex).toBe(1)
  })

  it('uses startMs when preRollMs is missing', () => {
    const [segment] = planSegments(noPreRollProject, { keepersOnly: true })
    expect(segment?.timelineStartMs).toBe(10000)
  })

  it('trims take-late by latencyCompMs', () => {
    const segments = planSegments(project, { keepersOnly: false })
    const late = segments.find((segment) => segment.takeId === 'take-late')
    expect(late).toMatchObject({
      trimLeadingMs: 87,
      durationMs: 3913,
      timelineStartMs: 9750,
    })
  })

  it('keepersOnly true does not include take-unrated', () => {
    const keepers = planSegments(project, { keepersOnly: true })
    expect(keepers.map((segment) => segment.takeId)).toEqual(['take-p1', 'take-p2'])
    expect(keepers.some((segment) => segment.takeId === 'take-unrated')).toBe(false)
  })

  it('numbers phrase 2 as phraseIndex 2 even when the phrases array is reversed', () => {
    const segments = planSegments(reversedArrayProject, { keepersOnly: true })
    const p2 = segments.find((segment) => segment.takeId === 'take-p2')
    expect(p2?.phraseIndex).toBe(2)
    expect(p2?.phraseName).toBe('Phrase 2')
  })

  it('skips orphan takes whose phrase or part is missing', () => {
    expect(planSegments(orphanProject, { keepersOnly: false })).toEqual([])
  })

  it('sorts results by timelineStartMs, then phraseIndex, then takeIndex', () => {
    const ids = planSegments(project, { keepersOnly: false }).map((segment) => segment.takeId)
    expect(ids).toEqual(['take-p1', 'take-unrated', 'take-p2', 'take-late'])
    const starts = planSegments(project, { keepersOnly: false }).map((segment) => segment.timelineStartMs)
    expect(starts).toEqual([0, 0, 9750, 9750])
  })
})

function seg(partial: Partial<PlannedSegment> = {}): PlannedSegment {
  return {
    takeId: 't',
    audioBlobId: 'blob',
    voicePartId: 'bass',
    partName: 'Bass',
    shortLabel: 'B',
    phraseIndex: 1,
    phraseName: 'P',
    takeIndex: 1,
    timelineStartMs: 0,
    trimLeadingMs: 0,
    durationMs: 1000,
    ...partial,
  }
}

function bufferOf(samples: number[], sampleRate = 1000): AudioBuffer {
  return {
    numberOfChannels: 1,
    length: samples.length,
    sampleRate,
    duration: samples.length / sampleRate,
    getChannelData: () => Float32Array.from(samples),
  } as unknown as AudioBuffer
}

function laneOf(segments: PlannedSegment[], partName = 'Bass'): ExportLane {
  return {
    voicePartId: segments[0]?.voicePartId ?? 'bass',
    partName,
    laneIndex: 0,
    path: 'Bass/Bass_A.wav',
    segments,
  }
}

function laneKeys(lanes: ReturnType<typeof assignLanes>): string[] {
  return lanes.map((lane) => `${lane.path}:${lane.segments.map((s) => s.takeId).join(',')}`)
}

describe('bindDecodedDuration', () => {
  it('binds 1500-sample buffer @ 1kHz minus 50ms trim to 1450; does not mutate original', () => {
    const original = seg({ durationMs: 1000, trimLeadingMs: 50 })
    const bound = bindDecodedDuration(original, bufferOf(Array(1500).fill(0), 1000))
    expect(bound.durationMs).toBe(1450)
    expect(bound).not.toBe(original)
    expect(original.durationMs).toBe(1000)
  })

  it('clamps durationMs to 0 when trim is longer than the buffer', () => {
    const original = seg({ durationMs: 1000, trimLeadingMs: 2000 })
    const bound = bindDecodedDuration(original, bufferOf(Array(500).fill(0), 1000))
    expect(bound.durationMs).toBe(0)
    expect(original.durationMs).toBe(1000)
  })
})

describe('assignLanes', () => {
  it('is LANE_FADE_MS 5 and LANE_MIN_GAP_MS 10', () => {
    expect(LANE_FADE_MS).toBe(5)
    expect(LANE_MIN_GAP_MS).toBe(2 * LANE_FADE_MS)
    expect(LANE_MIN_GAP_MS).toBe(10)
  })

  it('puts non-overlapping 0-1000 and 5000-6000 on 1 lane [a,b]', () => {
    const a = seg({ takeId: 'a', timelineStartMs: 0, durationMs: 1000 })
    const b = seg({ takeId: 'b', timelineStartMs: 5000, durationMs: 1000 })
    const lanes = assignLanes([a, b])
    expect(lanes).toHaveLength(1)
    expect(lanes[0]?.path).toBe('Bass/Bass_A.wav')
    expect(lanes[0]?.segments.map((s) => s.takeId)).toEqual(['a', 'b'])
  })

  it('opens 2 lanes when 0-1000 overlaps 900-1900', () => {
    const a = seg({ takeId: 'a', timelineStartMs: 0, durationMs: 1000 })
    const b = seg({ takeId: 'b', timelineStartMs: 900, durationMs: 1000 })
    const lanes = assignLanes([a, b])
    expect(lanes).toHaveLength(2)
    expect(lanes[0]?.segments.map((s) => s.takeId)).toEqual(['a'])
    expect(lanes[1]?.segments.map((s) => s.takeId)).toEqual(['b'])
  })

  it('opens 3 lanes Bass_A/B/C for three doubles at the same start', () => {
    const doubles = [1, 2, 3].map((n) =>
      seg({ takeId: `d${n}`, takeIndex: n, timelineStartMs: 0, durationMs: 1000 }),
    )
    const lanes = assignLanes(doubles)
    expect(lanes.map((lane) => lane.path)).toEqual([
      'Bass/Bass_A.wav',
      'Bass/Bass_B.wav',
      'Bass/Bass_C.wav',
    ])
    expect(lanes.map((lane) => lane.laneIndex)).toEqual([0, 1, 2])
    expect(lanes.map((lane) => lane.segments.map((s) => s.takeId))).toEqual([['d1'], ['d2'], ['d3']])
  })

  it('reuses lane A after it ended (a 0-1000, b 500-1500, c 5000-6000 → A has a,c; B has b)', () => {
    const a = seg({ takeId: 'a', timelineStartMs: 0, durationMs: 1000 })
    const b = seg({ takeId: 'b', timelineStartMs: 500, durationMs: 1000 })
    const c = seg({ takeId: 'c', timelineStartMs: 5000, durationMs: 1000 })
    const lanes = assignLanes([a, b, c])
    expect(lanes).toHaveLength(2)
    expect(lanes[0]?.segments.map((s) => s.takeId)).toEqual(['a', 'c'])
    expect(lanes[1]?.segments.map((s) => s.takeId)).toEqual(['b'])
  })

  it('opens a second lane when b starts at 1000+LANE_MIN_GAP_MS-1', () => {
    const a = seg({ takeId: 'a', timelineStartMs: 0, durationMs: 1000 })
    const b = seg({
      takeId: 'b',
      timelineStartMs: 1000 + LANE_MIN_GAP_MS - 1,
      durationMs: 1000,
    })
    const lanes = assignLanes([a, b])
    expect(lanes).toHaveLength(2)
  })

  it('never mixes voice parts on a lane; Alto_A and Bass_A stay separate', () => {
    const alto = seg({
      takeId: 'alto',
      voicePartId: 'alto',
      partName: 'Alto',
      shortLabel: 'A',
      timelineStartMs: 0,
      durationMs: 1000,
    })
    const bass = seg({
      takeId: 'bass',
      voicePartId: 'bass',
      partName: 'Bass',
      shortLabel: 'B',
      timelineStartMs: 0,
      durationMs: 1000,
    })
    const lanes = assignLanes([bass, alto])
    expect(lanes.map((lane) => lane.path)).toEqual(['Alto/Alto_A.wav', 'Bass/Bass_A.wav'])
    expect(lanes.every((lane) => new Set(lane.segments.map((s) => s.voicePartId)).size === 1)).toBe(
      true,
    )
  })

  it('orders parts by partName then id, Alto then Tenor, not insertion order', () => {
    const tenor = seg({
      takeId: 'tenor',
      voicePartId: 'tenor',
      partName: 'Tenor',
      shortLabel: 'T',
    })
    const alto = seg({
      takeId: 'alto',
      voicePartId: 'alto',
      partName: 'Alto',
      shortLabel: 'A',
    })
    const lanes = assignLanes([tenor, alto])
    expect(lanes.map((lane) => lane.path)).toEqual(['Alto/Alto_A.wav', 'Tenor/Tenor_A.wav'])
    expect(lanes.map((lane) => lane.partName)).toEqual(['Alto', 'Tenor'])
  })

  it('is deterministic regardless of input order', () => {
    const a = seg({ takeId: 'a', timelineStartMs: 0, durationMs: 1000, takeIndex: 1 })
    const b = seg({ takeId: 'b', timelineStartMs: 500, durationMs: 1000, takeIndex: 2 })
    const c = seg({ takeId: 'c', timelineStartMs: 5000, durationMs: 1000, takeIndex: 3 })
    const forward = assignLanes([a, b, c])
    const reversed = assignLanes([c, b, a])
    expect(laneKeys(reversed).sort()).toEqual(laneKeys(forward).sort())
    expect(laneKeys(reversed)).toEqual(laneKeys(forward))
  })

  it('never overlaps segments inside a lane (prev end <= next start)', () => {
    const many = [
      seg({ takeId: 'a', timelineStartMs: 0, durationMs: 800, takeIndex: 1 }),
      seg({ takeId: 'b', timelineStartMs: 200, durationMs: 800, takeIndex: 2 }),
      seg({ takeId: 'c', timelineStartMs: 400, durationMs: 800, takeIndex: 3 }),
      seg({ takeId: 'd', timelineStartMs: 2000, durationMs: 500, takeIndex: 4 }),
      seg({ takeId: 'e', timelineStartMs: 2100, durationMs: 500, takeIndex: 5 }),
      seg({ takeId: 'f', timelineStartMs: 4000, durationMs: 200, takeIndex: 6 }),
      seg({
        takeId: 'g',
        voicePartId: 'alto',
        partName: 'Alto',
        timelineStartMs: 0,
        durationMs: 3000,
        takeIndex: 1,
      }),
    ]
    const lanes = assignLanes(many)
    for (const lane of lanes) {
      for (let i = 1; i < lane.segments.length; i++) {
        const prev = lane.segments[i - 1]!
        const next = lane.segments[i]!
        expect(prev.timelineStartMs + prev.durationMs).toBeLessThanOrEqual(next.timelineStartMs)
      }
    }
  })

  it('returns [] for []', () => {
    expect(assignLanes([])).toEqual([])
  })

  it('opens a second lane after bindDecodedDuration overrun; estimate stays on 1 lane', () => {
    const a = seg({ takeId: 'a', timelineStartMs: 0, durationMs: 1000, trimLeadingMs: 0 })
    const b = seg({ takeId: 'b', timelineStartMs: 1100, durationMs: 500, takeIndex: 2 })
    expect(assignLanes([a, b])).toHaveLength(1)

    const boundA = bindDecodedDuration(a, bufferOf(Array(1500).fill(0), 1000))
    expect(boundA.durationMs).toBe(1500)
    expect(a.durationMs).toBe(1000)
    expect(assignLanes([boundA, b])).toHaveLength(2)
  })
})

describe('renderLanePcm', () => {
  const RATE = 48000

  it('output length is totalMs at sampleRate', () => {
    const pcm = renderLanePcm(laneOf([seg({ takeId: 'a' })]), {
      sampleRate: RATE,
      totalMs: 2000,
      buffers: new Map([['a', bufferOf(Array(msToSamples(100, RATE)).fill(1), RATE)]]),
    })
    expect(pcm.length).toBe(RATE * 2)
  })

  it('places a 100ms segment of 1.0 at 1000ms', () => {
    const pcm = renderLanePcm(
      laneOf([seg({ takeId: 'a', timelineStartMs: 1000, durationMs: 100 })]),
      {
        sampleRate: RATE,
        totalMs: 2000,
        buffers: new Map([['a', bufferOf(Array(msToSamples(100, RATE)).fill(1), RATE)]]),
      },
    )
    expect(pcm[0]).toBe(0)
    expect(pcm[RATE - 1]).toBe(0)
    expect(pcm[RATE + 480]).toBe(32767)
  })

  it('applies linear edge fades so first and last samples of a segment are 0', () => {
    const count = msToSamples(100, RATE)
    const pcm = renderLanePcm(
      laneOf([seg({ takeId: 'a', timelineStartMs: 1000, durationMs: 100 })]),
      {
        sampleRate: RATE,
        totalMs: 2000,
        buffers: new Map([['a', bufferOf(Array(count).fill(1), RATE)]]),
      },
    )
    expect(pcm[RATE]).toBe(0)
    expect(Math.abs(pcm[RATE + 120] ?? 0)).toBeLessThan(32767)
    expect(pcm[RATE + count - 1]).toBe(0)
  })

  it('trims trimLeadingMs off the source head', () => {
    const samples = [...Array(48).fill(0.9), ...Array(RATE).fill(0.1)]
    const pcm = renderLanePcm(
      laneOf([seg({ takeId: 'a', timelineStartMs: 0, trimLeadingMs: 1 })]),
      {
        sampleRate: RATE,
        totalMs: 1000,
        buffers: new Map([['a', bufferOf(samples, RATE)]]),
      },
    )
    // i=47 is the last junk (0.9) sample if trimLeadingMs is ignored.
    // After a 1ms trim it is faded 0.1, not faded 0.9.
    const edge = msToSamples(LANE_FADE_MS, RATE)
    const i = 47
    expect(pcm[0]).toBe(0)
    expect(pcm[i]).toBe(Math.round(0.1 * (i / edge) * 32767))
    expect(pcm[i]).not.toBe(Math.round(0.9 * (i / edge) * 32767))
  })

  it('skips segments whose buffer is missing without throwing', () => {
    const pcm = renderLanePcm(laneOf([seg({ takeId: 'missing' })]), {
      sampleRate: RATE,
      totalMs: 1000,
      buffers: new Map(),
    })
    expect(pcm.every((v: number) => v === 0)).toBe(true)
  })

  it('truncates overhang so output length stays totalMs', () => {
    const pcm = renderLanePcm(laneOf([seg({ takeId: 'a', timelineStartMs: 0 })]), {
      sampleRate: RATE,
      totalMs: 1000,
      buffers: new Map([['a', bufferOf(Array(RATE * 2).fill(1), RATE)]]),
    })
    expect(pcm.length).toBe(RATE)
  })

  it('skips a segment that starts past the end', () => {
    const pcm = renderLanePcm(laneOf([seg({ takeId: 'a', timelineStartMs: 2000 })]), {
      sampleRate: RATE,
      totalMs: 1000,
      buffers: new Map([['a', bufferOf(Array(RATE).fill(1), RATE)]]),
    })
    expect(pcm.length).toBe(RATE)
    expect(pcm.every((v: number) => v === 0)).toBe(true)
  })

  it('adds overlapping segments instead of overwriting', () => {
    const pcm = renderLanePcm(
      laneOf([
        seg({ takeId: 'a', timelineStartMs: 0, durationMs: 1000 }),
        seg({ takeId: 'b', timelineStartMs: 1100, durationMs: 500, takeIndex: 2 }),
      ]),
      {
        sampleRate: 1000,
        totalMs: 2000,
        buffers: new Map([
          ['a', bufferOf(Array(1500).fill(0.5), 1000)],
          ['b', bufferOf(Array(500).fill(0.5), 1000)],
        ]),
      },
    )
    expect(pcm[1200] ?? 0).toBeGreaterThan(Math.round(0.5 * 32767))
  })

  it('shrinks fades on a short 3ms segment instead of ducking it', () => {
    const count = msToSamples(3, RATE)
    const pcm = renderLanePcm(
      laneOf([seg({ takeId: 'a', timelineStartMs: 0, durationMs: 3 })]),
      {
        sampleRate: RATE,
        totalMs: 1000,
        buffers: new Map([['a', bufferOf(Array(count).fill(1), RATE)]]),
      },
    )
    expect(Math.max(...pcm)).toBeGreaterThan(0.9 * 32767)
  })
})
