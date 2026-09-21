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
    <section className="flex min-h-0 flex-1 flex-col gap-2" aria-label="Current phrase">
      <div className="shrink-0">
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
          <p className="mt-1 max-w-md text-ink/70">{phrase.notesForSinger}</p>
        ) : null}
      </div>
      <div className="relative min-h-0 flex-1">
        <SheetCue
          crops={sheetCrops}
          pageImageUrls={pageImageUrls}
          progress={sheetProgress}
          center={sheetCenter}
          onPickPosition={onPickSheet}
        />
      </div>
    </section>
  )
}
