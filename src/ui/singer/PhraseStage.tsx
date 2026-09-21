import type { Phrase, SheetRef } from '../../domain/schemas.ts'
import { SheetCue } from './SheetCue.tsx'

export type PhraseStageProps = {
  phrase: Phrase
  phraseIndex: number
  phraseCount: number
  partColor?: string
  sheetCrops?: SheetRef[]
  pageImageUrls?: Array<string | null | undefined>
  /** Camera 0–1 along the song film. */
  sheetProgress?: number | null
  sheetCenter?: boolean
  onPickSheet?: (u: number) => void
}

export function PhraseStage({
  phrase,
  phraseIndex,
  phraseCount,
  partColor,
  sheetCrops = [],
  pageImageUrls = [],
  sheetProgress = null,
  sheetCenter = false,
  onPickSheet,
}: PhraseStageProps) {
  const lyric = phrase.lyricText?.trim() || phrase.name

  return (
    <section className="flex max-w-2xl flex-col gap-4" aria-label="Current phrase">
      <p className="flex items-center gap-2 text-sm tracking-wide text-ink-muted">
        {partColor ? (
          <span
            className="h-2.5 w-2.5 rounded-pill"
            style={{ backgroundColor: partColor }}
            aria-hidden
          />
        ) : null}
        Phrase {phraseIndex} of {phraseCount}
      </p>
      <p className="font-display text-lyric leading-snug">{lyric}</p>
      {phrase.notesForSinger ? (
        <p className="max-w-md text-ink/70">{phrase.notesForSinger}</p>
      ) : null}
      <SheetCue
        crops={sheetCrops}
        pageImageUrls={pageImageUrls}
        progress={sheetProgress}
        center={sheetCenter}
        onPickPosition={onPickSheet}
      />
    </section>
  )
}
