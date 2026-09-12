import type { Phrase } from '../../domain/schemas.ts'

export type PhraseStageProps = {
  phrase: Phrase
  phraseIndex: number
  phraseCount: number
  partColor: string
}

export function PhraseStage({ phrase, phraseIndex, phraseCount, partColor }: PhraseStageProps) {
  const lyric = phrase.lyricText?.trim() || phrase.name

  return (
    <section className="flex max-w-2xl flex-col gap-4" aria-label="Current phrase">
      <p className="flex items-center gap-2 text-sm tracking-wide text-ink-muted">
        <span
          className="h-2.5 w-2.5 rounded-pill"
          style={{ backgroundColor: partColor }}
          aria-hidden
        />
        Phrase {phraseIndex} of {phraseCount}
      </p>
      <p className="font-display text-lyric leading-snug">{lyric}</p>
      {phrase.notesForSinger ? (
        <p className="max-w-md text-ink/70">{phrase.notesForSinger}</p>
      ) : null}
      {/* Sheet crop arrives in Task 14 */}
      <div hidden data-sheet-cue="" />
    </section>
  )
}
