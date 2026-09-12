import { z } from 'zod'

export type PhraseInterval = {
  id?: string
  startMs: number
  endMs: number
}

export function assertNoPhraseOverlap(phrases: PhraseInterval[]): void {
  for (let i = 0; i < phrases.length; i++) {
    for (let j = i + 1; j < phrases.length; j++) {
      const a = phrases[i]
      const b = phrases[j]
      if (a.startMs < b.endMs && b.startMs < a.endMs) {
        throw new Error(
          `Phrases overlap on the ghost timeline: ${a.id ?? 'phrase'} [${a.startMs}, ${a.endMs}] and ${b.id ?? 'phrase'} [${b.startMs}, ${b.endMs}]`,
        )
      }
    }
  }
}

export function validatePhrases(phrases: PhraseInterval[]): void {
  for (const phrase of phrases) {
    if (!(phrase.startMs < phrase.endMs)) {
      throw new Error(
        `Phrase ${phrase.id ?? ''} startMs must be less than endMs (got ${phrase.startMs}..${phrase.endMs})`,
      )
    }
  }
  assertNoPhraseOverlap(phrases)
}

export const LoopPolicySchema = z.object({
  mode: z.enum(['phrase-loop', 'section-continuous', 'once']),
  gapMs: z.number().nonnegative(),
})

export const VoicePartSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortLabel: z.string().min(1),
  color: z.string().min(1),
  singerHint: z.string().optional(),
  targetTakes: z.int().positive(),
  isGhost: z.boolean().optional(),
})

export const SectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  timeMode: z.enum(['ghost-follow', 'fixed-tempo']),
  fixedBpm: z.number().positive().optional(),
  startMs: z.number(),
  endMs: z.number(),
  clickEnabled: z.boolean(),
})

export const RegionNormSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
})

export const SheetRefSchema = z.object({
  id: z.string().min(1),
  sheetDocId: z.string().min(1),
  pageIndex: z.int().nonnegative(),
  regionNorm: RegionNormSchema.optional(),
  label: z.string().optional(),
})

export const PhrasePartStatusSchema = z.enum(['not-started', 'in-progress', 'enough', 'final'])

export const RequiredGuideSchema = z.enum(['ghost', 'tonal', 'stack', 'click'])

export const PhrasePartPlanSchema = z.object({
  voicePartId: z.string().min(1),
  priority: z.int(),
  targetTakes: z.int().positive(),
  requiredGuide: z.array(RequiredGuideSchema),
  sheetRefIds: z.array(z.string().min(1)).optional(),
  status: PhrasePartStatusSchema,
})

export const PhraseSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    sectionId: z.string().min(1).optional(),
    startMs: z.number(),
    endMs: z.number(),
    lyricText: z.string().optional(),
    sheetRefs: z.array(SheetRefSchema),
    partPlan: z.array(PhrasePartPlanSchema),
    loopDefault: LoopPolicySchema,
    preRollMs: z.number().nonnegative().optional(),
    preRollBeats: z.number().nonnegative().optional(),
    postRollMs: z.number().nonnegative(),
    notesForSinger: z.string().optional(),
  })
  .refine((phrase) => phrase.startMs < phrase.endMs, {
    message: 'Phrase startMs must be less than endMs',
    path: ['endMs'],
  })

export const GuideAssetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['ghost', 'tonal', 'click', 'reference-stack', 'other']),
  audioBlobId: z.string().min(1),
  gainDbDefault: z.number(),
  alignToGhost: z.literal(true),
})

export const SheetPageSchema = z.object({
  pageIndex: z.int().nonnegative(),
  imageBlobId: z.string().min(1).optional(),
})

export const SheetDocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.enum(['pdf', 'images', 'musicxml']),
  pdfBlobId: z.string().min(1).optional(),
  pages: z.array(SheetPageSchema),
})

export const MixLayerSchema = z.object({
  guideOrTakeRef: z.string().min(1),
  gainDb: z.number(),
  pan: z.number().min(-1).max(1),
  mute: z.boolean(),
})

export const MixPresetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  layers: z.array(MixLayerSchema),
})

export const HeadphoneMixSnapshotSchema = z.object({
  layers: z.array(MixLayerSchema),
})

export const TakeRatingSchema = z.union([
  z.int().min(1).max(5),
  z.enum(['keeper', 'scratch']),
])

export const TakeSchema = z.object({
  id: z.string().min(1),
  phraseId: z.string().min(1),
  voicePartId: z.string().min(1),
  takeIndex: z.int().positive(),
  audioBlobId: z.string().min(1),
  recordedAt: z.iso.datetime(),
  durationMs: z.number().nonnegative(),
  rating: TakeRatingSchema.optional(),
  notes: z.string().optional(),
  headphoneMixSnapshot: HeadphoneMixSnapshotSchema,
  latencyCompMs: z.number().optional(),
  peakDb: z.number(),
  clipFlag: z.boolean().optional(),
})

export const CompletionCellSchema = z.object({
  phraseId: z.string().min(1),
  voicePartId: z.string().min(1),
  takeCount: z.int().nonnegative(),
  keeperCount: z.int().nonnegative(),
  status: PhrasePartStatusSchema,
})

export const CompletionStateSchema = z.object({
  cells: z.array(CompletionCellSchema),
})

export const GhostMetaSchema = z.object({
  filename: z.string().min(1),
  durationMs: z.number().nonnegative(),
})

export const ProjectSettingsSchema = z.object({
  language: z.string().min(1).default('en'),
  ghostMeta: GhostMetaSchema.optional(),
})

export const ProjectSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    key: z.string().optional(),
    defaultTuningHz: z.number().positive().default(440),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    voiceRoster: z.array(VoicePartSchema),
    ghostTrackId: z.string().min(1).nullable(),
    sections: z.array(SectionSchema),
    phrases: z.array(PhraseSchema),
    guides: z.array(GuideAssetSchema),
    sheetDocs: z.array(SheetDocumentSchema),
    takes: z.array(TakeSchema),
    completion: CompletionStateSchema,
    mixPresets: z.array(MixPresetSchema),
    settings: ProjectSettingsSchema,
  })
  .superRefine((project, ctx) => {
    try {
      validatePhrases(project.phrases)
    } catch (error) {
      ctx.addIssue(error instanceof Error ? error.message : 'Invalid phrases')
    }
  })

export type LoopPolicy = z.infer<typeof LoopPolicySchema>
export type VoicePart = z.infer<typeof VoicePartSchema>
export type Section = z.infer<typeof SectionSchema>
export type RegionNorm = z.infer<typeof RegionNormSchema>
export type SheetRef = z.infer<typeof SheetRefSchema>
export type PhrasePartStatus = z.infer<typeof PhrasePartStatusSchema>
export type RequiredGuide = z.infer<typeof RequiredGuideSchema>
export type PhrasePartPlan = z.infer<typeof PhrasePartPlanSchema>
export type Phrase = z.infer<typeof PhraseSchema>
export type GuideAsset = z.infer<typeof GuideAssetSchema>
export type SheetPage = z.infer<typeof SheetPageSchema>
export type SheetDocument = z.infer<typeof SheetDocumentSchema>
export type MixLayer = z.infer<typeof MixLayerSchema>
export type MixPreset = z.infer<typeof MixPresetSchema>
export type HeadphoneMixSnapshot = z.infer<typeof HeadphoneMixSnapshotSchema>
export type TakeRating = z.infer<typeof TakeRatingSchema>
export type Take = z.infer<typeof TakeSchema>
export type CompletionCell = z.infer<typeof CompletionCellSchema>
export type CompletionState = z.infer<typeof CompletionStateSchema>
export type GhostMeta = z.infer<typeof GhostMetaSchema>
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>
export type Project = z.infer<typeof ProjectSchema>

export function createEmptyProject(title = 'Untitled song'): Project {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title,
    defaultTuningHz: 440,
    createdAt: now,
    updatedAt: now,
    voiceRoster: [],
    ghostTrackId: null,
    sections: [],
    phrases: [],
    guides: [],
    sheetDocs: [],
    takes: [],
    completion: { cells: [] },
    mixPresets: [],
    settings: { language: 'en' },
  }
}
