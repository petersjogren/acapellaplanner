import { describe, expect, it } from 'vitest'
import { createEmptyProject, type Phrase, type Take, type VoicePart } from '../../src/domain/schemas.ts'
import {
  laneLetter,
  lanePath,
  planSegments,
  safeSegment,
  segmentStartMs,
  stemPath,
} from '../../src/storage/dawExport.ts'

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
