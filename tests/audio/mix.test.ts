import { describe, expect, it } from 'vitest'
import {
  BLEND_CHECK_PRESET_ID,
  GHOST_FOCUS_PRESET_ID,
  STACK_BUILD_PRESET_ID,
  builtinMixPresets,
  dbToGain,
  loadAllKeepersMixForSong,
  loadKeeperBuffers,
  loadTakeReviewMix,
  mixPresetById,
  mixPresetDescription,
  playbackMixFromResolved,
  resolveMix,
  stackKeepersForReview,
} from '../../src/audio/mix.ts'
import type { MixPreset, Project, Take } from '../../src/domain/schemas.ts'

function take(overrides: Partial<Take> & { id: string }): Take {
  return {
    phraseId: 'p1',
    voicePartId: 's1',
    takeIndex: 1,
    audioBlobId: `${overrides.id}-blob`,
    recordedAt: '2026-09-12T10:00:00.000Z',
    durationMs: 1000,
    headphoneMixSnapshot: { layers: [] },
    peakDb: 0,
    rating: 'keeper',
    ...overrides,
  }
}

describe('mixPresetDescription', () => {
  it('describes each built-in preset', () => {
    expect(mixPresetDescription(GHOST_FOCUS_PRESET_ID)).toMatch(/ghost full/i)
    expect(mixPresetDescription(STACK_BUILD_PRESET_ID)).toMatch(/keepers up/i)
    expect(mixPresetDescription(BLEND_CHECK_PRESET_ID)).toMatch(/ghost muted/i)
  })

  it('falls back to the default preset for an unknown id', () => {
    expect(mixPresetDescription('nope')).toBe(mixPresetDescription(GHOST_FOCUS_PRESET_ID))
    expect(mixPresetDescription(undefined)).toMatch(/ghost full/i)
  })
})

describe('stackKeepersForReview', () => {
  it('excludes the take under review and any non-keeper', () => {
    const project: Pick<Project, 'takes'> = {
      takes: [
        take({ id: 'keeper-1' }),
        take({ id: 'under-review' }),
        take({ id: 'scratch-1', rating: 'scratch' }),
        take({ id: 'other-phrase', phraseId: 'p2' }),
      ],
    }
    expect(stackKeepersForReview(project, 'p1', 'under-review').map((item) => item.id)).toEqual([
      'keeper-1',
    ])
  })
})

describe('loadTakeReviewMix', () => {
  const takeBuffer = { duration: 2 } as AudioBuffer
  const keeperBuffer = { duration: 2 } as AudioBuffer

  function projectWithKeepers(): Project {
    return {
      guides: [
        { id: 'g', kind: 'ghost', audioBlobId: 'ghost', gainDbDefault: 0, alignToGhost: true },
      ],
      takes: [take({ id: 'keeper-1' }), take({ id: 'under-review' })],
    } as unknown as Project
  }

  it('solo mutes the ghost and plays only the take', async () => {
    const mix = await loadTakeReviewMix(
      projectWithKeepers(),
      'p1',
      { takeId: 'under-review', takeBuffer, mode: 'solo' },
      async () => keeperBuffer,
    )
    expect(mix.ghostMute).toBe(true)
    expect(mix.extra).toHaveLength(1)
    expect(mix.extra?.[0]?.buffer).toBe(takeBuffer)
  })

  it('ghost plays the take against an unmuted ghost', async () => {
    const mix = await loadTakeReviewMix(
      projectWithKeepers(),
      'p1',
      { takeId: 'under-review', takeBuffer, mode: 'ghost' },
      async () => keeperBuffer,
    )
    expect(mix.ghostMute).toBe(false)
    expect(mix.extra).toHaveLength(1)
  })

  it('stack adds the other keepers alongside the take', async () => {
    const mix = await loadTakeReviewMix(
      projectWithKeepers(),
      'p1',
      { takeId: 'under-review', takeBuffer, mode: 'stack' },
      async () => keeperBuffer,
    )
    // one keeper + the take itself, and the take is never doubled
    expect(mix.extra).toHaveLength(2)
    expect(mix.extra?.filter((layer) => layer.buffer === takeBuffer)).toHaveLength(1)
    expect(mix.ghostGainDb).toBe(-6) // Stack Build balance
  })

  it('applies latency compensation as a take offset', async () => {
    const mix = await loadTakeReviewMix(
      projectWithKeepers(),
      'p1',
      { takeId: 'under-review', takeBuffer, latencyCompMs: 87, mode: 'solo' },
      async () => keeperBuffer,
    )
    expect(mix.extra?.[0]?.offsetMs).toBe(87)
  })

  it('never schedules a click while auditioning', async () => {
    for (const mode of ['ghost', 'stack', 'solo'] as const) {
      const mix = await loadTakeReviewMix(
        projectWithKeepers(),
        'p1',
        { takeId: 'under-review', takeBuffer, mode },
        async () => keeperBuffer,
      )
      expect(mix.click).toBe(false)
    }
  })
})

describe('loadAllKeepersMixForSong', () => {
  const bufferFor = (): AudioBuffer => ({ duration: 2 } as AudioBuffer)

  function projectWithTwoPhrasesOfKeepers(): Project {
    return {
      guides: [
        { id: 'g', kind: 'ghost', audioBlobId: 'ghost', gainDbDefault: 0, alignToGhost: true },
      ],
      phrases: [
        { id: 'p1', startMs: 0, endMs: 2000, preRollMs: 0 },
        { id: 'p2', startMs: 5000, endMs: 7000, preRollMs: 500 },
      ],
      takes: [
        take({ id: 'k1', phraseId: 'p1' }),
        take({ id: 'k2', phraseId: 'p2' }),
        take({ id: 'scratch', phraseId: 'p1', rating: 'scratch' }),
      ],
    } as unknown as Project
  }

  it('places each keeper at its own phrase start minus pre-roll', async () => {
    const mix = await loadAllKeepersMixForSong(
      projectWithTwoPhrasesOfKeepers(),
      STACK_BUILD_PRESET_ID,
      async () => bufferFor(),
    )

    expect(mix.extra).toHaveLength(2)
    const delays = (mix.extra ?? [])
      .map((layer) => layer.startDelayMs ?? 0)
      .sort((a, b) => a - b)
    expect(delays).toEqual([0, 4500]) // p1: 0 - 0; p2: 5000 - 500
  })

  it('excludes non-keeper takes', async () => {
    const mix = await loadAllKeepersMixForSong(
      projectWithTwoPhrasesOfKeepers(),
      STACK_BUILD_PRESET_ID,
      async () => bufferFor(),
    )
    expect(mix.extra).toHaveLength(2)
  })

  it('with-ghost preset leaves the ghost audible; no-ghost mutes it', async () => {
    const withGhost = await loadAllKeepersMixForSong(
      projectWithTwoPhrasesOfKeepers(),
      STACK_BUILD_PRESET_ID,
      async () => bufferFor(),
    )
    expect(withGhost.ghostMute).toBe(false)

    const noGhost = await loadAllKeepersMixForSong(
      projectWithTwoPhrasesOfKeepers(),
      BLEND_CHECK_PRESET_ID,
      async () => bufferFor(),
    )
    expect(noGhost.ghostMute).toBe(true)
  })

  it('falls back to startDelayMs 0 for a keeper whose phrase no longer exists', async () => {
    const project = projectWithTwoPhrasesOfKeepers()
    project.phrases = [project.phrases[0]!] // drop p2 — k2 now points nowhere
    const mix = await loadAllKeepersMixForSong(
      project,
      STACK_BUILD_PRESET_ID,
      async () => bufferFor(),
    )
    expect(mix.extra).toHaveLength(2)
    const delays = (mix.extra ?? []).map((layer) => layer.startDelayMs)
    // p1's keeper is 0; the orphaned keeper falls back to 0 rather than
    // throwing — better to hear it misplaced than to drop it silently.
    expect(delays).toEqual([0, 0])
  })

  it('applies latency compensation as a take offset alongside startDelayMs', async () => {
    const project = projectWithTwoPhrasesOfKeepers()
    project.takes[0]!.latencyCompMs = 87
    const mix = await loadAllKeepersMixForSong(
      project,
      STACK_BUILD_PRESET_ID,
      async () => bufferFor(),
    )
    const withOffset = mix.extra?.find((layer) => layer.offsetMs === 87)
    expect(withOffset).toBeTruthy()
    expect(withOffset?.startDelayMs).toBe(0)
  })
})

describe('dbToGain', () => {
  it('converts decibels with 10^(db/20)', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(-6)).toBeCloseTo(10 ** (-6 / 20))
    expect(dbToGain(-24)).toBeCloseTo(10 ** (-24 / 20))
  })

  it('returns 0 when muted', () => {
    expect(dbToGain(0, true)).toBe(0)
    expect(dbToGain(-6, true)).toBe(0)
  })
})

describe('builtinMixPresets', () => {
  it('exports Ghost Focus, Stack Build, and Blend Check', () => {
    const presets = builtinMixPresets()
    expect(presets.map((preset) => preset.id)).toEqual([
      GHOST_FOCUS_PRESET_ID,
      STACK_BUILD_PRESET_ID,
      BLEND_CHECK_PRESET_ID,
    ])
    expect(presets.map((preset) => preset.name)).toEqual([
      'Ghost Focus',
      'Stack Build',
      'Blend Check',
    ])
  })

  it('sets ghost 0dB and muted keepers for Ghost Focus', () => {
    const preset = mixPresetById(GHOST_FOCUS_PRESET_ID)
    expect(preset.layers[0]).toEqual(
      expect.objectContaining({ guideOrTakeRef: 'ghost', gainDb: 0, mute: false }),
    )
    expect(preset.layers[1]).toEqual(
      expect.objectContaining({ guideOrTakeRef: 'keeper', gainDb: -24, mute: true }),
    )
  })

  it('ducks ghost between -6 and -9dB and keeps keepers at 0dB for Stack Build', () => {
    const preset = mixPresetById(STACK_BUILD_PRESET_ID)
    const ghost = preset.layers[0]
    expect(ghost?.gainDb).toBeGreaterThanOrEqual(-9)
    expect(ghost?.gainDb).toBeLessThanOrEqual(-6)
    expect(ghost?.mute).toBe(false)
    expect(preset.layers[1]).toEqual(
      expect.objectContaining({ guideOrTakeRef: 'keeper', gainDb: 0, mute: false }),
    )
  })

  it('mutes ghost and leaves keepers at 0dB for Blend Check', () => {
    const preset = mixPresetById(BLEND_CHECK_PRESET_ID)
    expect(preset.layers[0]).toEqual(
      expect.objectContaining({ guideOrTakeRef: 'ghost', mute: true }),
    )
    expect(preset.layers[1]).toEqual(
      expect.objectContaining({ guideOrTakeRef: 'keeper', gainDb: 0, mute: false }),
    )
  })
})

describe('resolveMix', () => {
  const ids = { ghostGuideId: 'ghost-guide', keeperTakeIds: ['k1', 'k2'] }

  it('expands the ghost layer onto the guide id and keepers onto take ids', () => {
    const resolved = resolveMix(mixPresetById(STACK_BUILD_PRESET_ID), ids)
    expect(resolved).toEqual([
      { ref: 'ghost-guide', gainDb: -6, mute: false, pan: 0 },
      { ref: 'k1', gainDb: 0, mute: false, pan: 0 },
      { ref: 'k2', gainDb: 0, mute: false, pan: 0 },
    ])
  })

  it('omits keeper layers when there are no keeper ids', () => {
    const resolved = resolveMix(mixPresetById(GHOST_FOCUS_PRESET_ID), {
      ghostGuideId: 'ghost-guide',
      keeperTakeIds: [],
    })
    expect(resolved).toEqual([{ ref: 'ghost-guide', gainDb: 0, mute: false, pan: 0 }])
  })

  it('keeps Ghost Focus keepers muted and Blend Check ghost muted', () => {
    const focus = resolveMix(mixPresetById(GHOST_FOCUS_PRESET_ID), ids)
    expect(focus.find((layer) => layer.ref === 'k1')).toEqual(
      expect.objectContaining({ gainDb: -24, mute: true }),
    )
    const blend = resolveMix(mixPresetById(BLEND_CHECK_PRESET_ID), ids)
    expect(blend[0]).toEqual(expect.objectContaining({ ref: 'ghost-guide', mute: true }))
    expect(blend[1]).toEqual(expect.objectContaining({ ref: 'k1', gainDb: 0, mute: false }))
  })
})

describe('loadKeeperBuffers', () => {
  it('skips missing buffers without throwing', async () => {
    const keepers = [take({ id: 'k1' }), take({ id: 'k2' }), take({ id: 'k3' })]
    const buffers = await loadKeeperBuffers(keepers, async (audioBlobId) => {
      if (audioBlobId === 'k2-blob') return null
      if (audioBlobId === 'k3-blob') throw new Error('undecodable')
      return { duration: 1 } as AudioBuffer
    })
    expect([...buffers.keys()]).toEqual(['k1'])
  })
})

describe('playbackMixFromResolved', () => {
  it('drops keeper layers whose buffers are missing', () => {
    const preset: MixPreset = mixPresetById(STACK_BUILD_PRESET_ID)
    const resolved = resolveMix(preset, {
      ghostGuideId: 'ghost-guide',
      keeperTakeIds: ['k1', 'k2'],
    })
    const mix = playbackMixFromResolved(
      resolved,
      'ghost-guide',
      new Map([['k1', { duration: 2 } as AudioBuffer]]),
    )
    expect(mix.ghostGainDb).toBe(-6)
    expect(mix.ghostMute).toBe(false)
    expect(mix.extra).toHaveLength(1)
    expect(mix.extra?.[0]?.gainDb).toBe(0)
    expect(mix.extra?.[0]?.offsetMs).toBe(0)
  })

  it('applies per-keeper latency as extra buffer offset', () => {
    const preset: MixPreset = mixPresetById(STACK_BUILD_PRESET_ID)
    const resolved = resolveMix(preset, {
      ghostGuideId: 'ghost-guide',
      keeperTakeIds: ['k1'],
    })
    const mix = playbackMixFromResolved(
      resolved,
      'ghost-guide',
      new Map([['k1', { duration: 2 } as AudioBuffer]]),
      new Map([['k1', 87]]),
    )
    expect(mix.extra?.[0]?.offsetMs).toBe(87)
  })
})
