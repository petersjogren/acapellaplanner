import { decodeAudioFile } from './decode.ts'
import { takePlaybackOffsetMs } from './latency.ts'
import type { HeadphoneMixSnapshot, MixPreset, Project, Take } from '../domain/schemas.ts'

export const GHOST_LAYER_REF = 'ghost'
export const KEEPER_LAYER_REF = 'keeper'

export const GHOST_FOCUS_PRESET_ID = 'ghost-focus'
export const STACK_BUILD_PRESET_ID = 'stack-build'
export const BLEND_CHECK_PRESET_ID = 'blend-check'

export type ResolvedMixLayer = {
  ref: string
  gainDb: number
  mute: boolean
  pan: number
}

export type MixPlaybackLayer = {
  buffer?: AudioBuffer | null
  gainDb: number
  mute?: boolean
  pan?: number
  /** Offset into this layer's buffer (ms). Ghost uses the play window; takes use latency skip. */
  offsetMs?: number
}

export type PlaybackMix = {
  ghostGainDb?: number
  ghostMute?: boolean
  extra?: MixPlaybackLayer[]
  /** When true and clickTimesMs is non-empty, the engine schedules click ticks. */
  click?: boolean
  /** Ghost-timeline click times (ms), typically from clicksForPhrase. */
  clickTimesMs?: number[]
}

export function dbToGain(db: number, mute = false): number {
  if (mute) return 0
  return 10 ** (db / 20)
}

export function builtinMixPresets(): MixPreset[] {
  return [
    {
      id: GHOST_FOCUS_PRESET_ID,
      name: 'Ghost Focus',
      layers: [
        { guideOrTakeRef: GHOST_LAYER_REF, gainDb: 0, pan: 0, mute: false },
        { guideOrTakeRef: KEEPER_LAYER_REF, gainDb: -24, pan: 0, mute: true },
      ],
    },
    {
      id: STACK_BUILD_PRESET_ID,
      name: 'Stack Build',
      layers: [
        { guideOrTakeRef: GHOST_LAYER_REF, gainDb: -6, pan: 0, mute: false },
        { guideOrTakeRef: KEEPER_LAYER_REF, gainDb: 0, pan: 0, mute: false },
      ],
    },
    {
      id: BLEND_CHECK_PRESET_ID,
      name: 'Blend Check',
      layers: [
        { guideOrTakeRef: GHOST_LAYER_REF, gainDb: 0, pan: 0, mute: true },
        { guideOrTakeRef: KEEPER_LAYER_REF, gainDb: 0, pan: 0, mute: false },
      ],
    },
  ]
}

export function mixPresetById(id: string | null | undefined): MixPreset {
  const presets = builtinMixPresets()
  return presets.find((preset) => preset.id === id) ?? presets[0]!
}

/**
 * What each recipe is for, in the singer's language. Kept out of MixPresetSchema
 * because presets are persisted per project — this is UI copy, not project data.
 */
const MIX_PRESET_DESCRIPTIONS: Record<string, string> = {
  [GHOST_FOCUS_PRESET_ID]: 'Ghost full, stack silent. For a first double — match her vowels and time.',
  [STACK_BUILD_PRESET_ID]: 'Ghost a little down, keepers up. For later doubles — sit inside the choir.',
  [BLEND_CHECK_PRESET_ID]: 'Ghost muted, keepers only. Hear whether the stack holds on its own.',
}

export function mixPresetDescription(id: string | null | undefined): string {
  return MIX_PRESET_DESCRIPTIONS[mixPresetById(id).id] ?? ''
}

export function ghostGuideId(project: Pick<Project, 'guides'>): string {
  return project.guides.find((guide) => guide.kind === 'ghost')?.id ?? GHOST_LAYER_REF
}

export function keeperTakesForPhrase(takes: Take[], phraseId: string): Take[] {
  return takes.filter((take) => take.phraseId === phraseId && take.rating === 'keeper')
}

export function resolveMix(
  preset: MixPreset,
  ids: { ghostGuideId: string; keeperTakeIds: string[] },
): ResolvedMixLayer[] {
  const ghostLayer = preset.layers.find(
    (layer) =>
      layer.guideOrTakeRef === GHOST_LAYER_REF || layer.guideOrTakeRef === ids.ghostGuideId,
  )
  const keeperLayer = preset.layers.find((layer) => layer.guideOrTakeRef === KEEPER_LAYER_REF)
  const resolved: ResolvedMixLayer[] = []
  if (ghostLayer) {
    resolved.push({
      ref: ids.ghostGuideId,
      gainDb: ghostLayer.gainDb,
      mute: ghostLayer.mute,
      pan: ghostLayer.pan,
    })
  }
  if (keeperLayer) {
    for (const takeId of ids.keeperTakeIds) {
      resolved.push({
        ref: takeId,
        gainDb: keeperLayer.gainDb,
        mute: keeperLayer.mute,
        pan: keeperLayer.pan,
      })
    }
  }
  return resolved
}

export function headphoneMixSnapshotFor(
  preset: MixPreset,
  ids: { ghostGuideId: string; keeperTakeIds: string[] },
): HeadphoneMixSnapshot {
  return {
    layers: resolveMix(preset, ids).map((layer) => ({
      guideOrTakeRef: layer.ref,
      gainDb: layer.gainDb,
      pan: layer.pan,
      mute: layer.mute,
    })),
  }
}

export function playbackMixFromResolved(
  resolved: ResolvedMixLayer[],
  guideId: string,
  keeperBuffers: Map<string, AudioBuffer>,
  keeperOffsetMs: Map<string, number> = new Map(),
): PlaybackMix {
  const ghost = resolved.find((layer) => layer.ref === guideId)
  const extra: MixPlaybackLayer[] = []
  for (const layer of resolved) {
    if (layer.ref === guideId) continue
    const buffer = keeperBuffers.get(layer.ref)
    if (!buffer) continue
    extra.push({
      buffer,
      gainDb: layer.gainDb,
      mute: layer.mute,
      pan: layer.pan,
      offsetMs: takePlaybackOffsetMs(keeperOffsetMs.get(layer.ref)),
    })
  }
  return {
    ghostGainDb: ghost?.gainDb ?? 0,
    ghostMute: ghost?.mute ?? false,
    extra,
  }
}

export async function loadKeeperBuffers(
  keepers: Take[],
  loadBuffer: (audioBlobId: string) => Promise<AudioBuffer | null>,
): Promise<Map<string, AudioBuffer>> {
  const buffers = new Map<string, AudioBuffer>()
  await Promise.all(
    keepers.map(async (take) => {
      try {
        const buffer = await loadBuffer(take.audioBlobId)
        if (buffer) buffers.set(take.id, buffer)
      } catch {
        // skip missing or undecodable keepers
      }
    }),
  )
  return buffers
}

export function createAudioBlobLoader(
  getAudioBlob: (id: string) => Promise<{ blob: Blob } | undefined>,
): (audioBlobId: string) => Promise<AudioBuffer | null> {
  return async (audioBlobId) => {
    const record = await getAudioBlob(audioBlobId)
    if (!record) return null
    try {
      return (await decodeAudioFile(record.blob)).buffer
    } catch {
      return null
    }
  }
}

export async function loadPlaybackMixForPhrase(
  project: Project,
  phraseId: string,
  presetId: string,
  loadBuffer: (audioBlobId: string) => Promise<AudioBuffer | null>,
): Promise<PlaybackMix> {
  const preset = mixPresetById(presetId)
  const guideId = ghostGuideId(project)
  const keepers = keeperTakesForPhrase(project.takes, phraseId)
  const keeperBuffers = await loadKeeperBuffers(keepers, loadBuffer)
  const keeperOffsetMs = new Map(
    keepers.map((take) => [take.id, takePlaybackOffsetMs(take.latencyCompMs)]),
  )
  return playbackMixFromResolved(
    resolveMix(preset, {
      ghostGuideId: guideId,
      keeperTakeIds: keepers.map((take) => take.id),
    }),
    guideId,
    keeperBuffers,
    keeperOffsetMs,
  )
}

/**
 * How a just-recorded take is auditioned:
 * - `ghost` — the take against the ghost, for checking time and vowels
 * - `stack` — the take inside the keepers already on this phrase, for blend
 * - `solo`  — the take alone, for hearing your own tone and tuning
 */
export const TAKE_REVIEW_MODES = ['ghost', 'stack', 'solo'] as const
export type TakeReviewMode = (typeof TAKE_REVIEW_MODES)[number]

export type TakeReviewOptions = {
  takeId: string
  takeBuffer: AudioBuffer
  latencyCompMs?: number
  mode: TakeReviewMode
}

/** Keepers on this phrase that are not the take being auditioned. */
export function stackKeepersForReview(
  project: Pick<Project, 'takes'>,
  phraseId: string,
  takeId: string,
): Take[] {
  return keeperTakesForPhrase(project.takes, phraseId).filter((take) => take.id !== takeId)
}

export async function loadTakeReviewMix(
  project: Project,
  phraseId: string,
  options: TakeReviewOptions,
  loadBuffer: (audioBlobId: string) => Promise<AudioBuffer | null>,
): Promise<PlaybackMix> {
  const takeLayer: MixPlaybackLayer = {
    buffer: options.takeBuffer,
    gainDb: 0,
    mute: false,
    pan: 0,
    offsetMs: takePlaybackOffsetMs(options.latencyCompMs),
  }

  if (options.mode === 'solo') {
    return { ghostGainDb: 0, ghostMute: true, extra: [takeLayer], click: false }
  }
  if (options.mode === 'ghost') {
    return { ghostGainDb: 0, ghostMute: false, extra: [takeLayer], click: false }
  }

  // Stack: borrow Stack Build's balance so there is one source of truth for
  // how a double sits against the ghost and the keepers.
  const preset = mixPresetById(STACK_BUILD_PRESET_ID)
  const ghostLayer = preset.layers.find((layer) => layer.guideOrTakeRef === GHOST_LAYER_REF)
  const keeperLayer = preset.layers.find((layer) => layer.guideOrTakeRef === KEEPER_LAYER_REF)
  // The take under review is its own layer; a kept take would double itself.
  const keepers = stackKeepersForReview(project, phraseId, options.takeId)
  const buffers = await loadKeeperBuffers(keepers, loadBuffer)

  const extra: MixPlaybackLayer[] = []
  for (const keeper of keepers) {
    const buffer = buffers.get(keeper.id)
    if (!buffer) continue
    extra.push({
      buffer,
      gainDb: keeperLayer?.gainDb ?? 0,
      mute: keeperLayer?.mute ?? false,
      pan: keeperLayer?.pan ?? 0,
      offsetMs: takePlaybackOffsetMs(keeper.latencyCompMs),
    })
  }
  extra.push(takeLayer)

  return {
    ghostGainDb: ghostLayer?.gainDb ?? 0,
    ghostMute: ghostLayer?.mute ?? false,
    extra,
    click: false,
  }
}
