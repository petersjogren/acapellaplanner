import { useState } from 'react'
import { keeperTakesForPhrase, type TakeReviewMode } from '../../audio/mix.ts'
import type { Project, TakeRating } from '../../domain/schemas.ts'

/** Review only ever solos a take with or without the ghost — never the
 * Sing-booth "stack" recipe, which folds in the take under review itself. */
export type ReviewTakeMode = Extract<TakeReviewMode, 'ghost' | 'solo'>

/** All keepers on a phrase, played together, with or without the ghost. */
export type AllKeepersMode = 'with-ghost' | 'no-ghost'

export type ReviewPlayback =
  | { kind: 'take'; takeId: string; mode: ReviewTakeMode }
  | { kind: 'phrase'; phraseId: string; mode: AllKeepersMode }

export type TakeReviewProps = {
  project: Project
  selectedPhraseId?: string | null
  onSelectPhrase?: (id: string | null) => void
  onRate: (takeId: string, rating: TakeRating) => void
  onPlayTake: (takeId: string, mode: ReviewTakeMode) => void
  onPlayAllKeepers: (phraseId: string, mode: AllKeepersMode) => void
  onStop?: () => void
  playing?: ReviewPlayback | null
}

const STAR_RATINGS = [1, 2, 3, 4, 5] as const

export function applyTakeRating(project: Project, takeId: string, rating: TakeRating): Project {
  if (!project.takes.some((take) => take.id === takeId)) return project
  return {
    ...project,
    takes: project.takes.map((take) => (take.id === takeId ? { ...take, rating } : take)),
  }
}

function ratingLabel(rating: TakeRating | undefined): string {
  if (rating === 'keeper') return 'Keeper'
  if (rating === 'scratch') return 'Scratch'
  if (typeof rating === 'number') return `${rating}/5`
  return 'Unrated'
}

const buttonClass =
  'rounded-md border border-ink/15 px-3 py-1.5 text-sm font-medium studio-transition hover:bg-ink/5 aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper'

const TAKE_MODE_LABELS: Record<ReviewTakeMode, string> = {
  ghost: 'With ghost',
  solo: 'Solo (no ghost)',
}

export function TakeReview({
  project,
  selectedPhraseId = null,
  onSelectPhrase,
  onRate,
  onPlayTake,
  onPlayAllKeepers,
  onStop,
  playing = null,
}: TakeReviewProps) {
  const [phraseFilter, setPhraseFilter] = useState(selectedPhraseId ?? '')
  const phrases = project.phrases
  const partsById = new Map(project.voiceRoster.map((part) => [part.id, part]))
  const takes = project.takes
    .filter((item) => !phraseFilter || item.phraseId === phraseFilter)
    .slice()
    .sort((a, b) => {
      if (a.phraseId !== b.phraseId) {
        return (
          phrases.findIndex((phrase) => phrase.id === a.phraseId) -
          phrases.findIndex((phrase) => phrase.id === b.phraseId)
        )
      }
      if (a.voicePartId !== b.voicePartId) return a.voicePartId.localeCompare(b.voicePartId)
      return a.takeIndex - b.takeIndex
    })

  const keeperCountForFilter = phraseFilter
    ? keeperTakesForPhrase(project.takes, phraseFilter).length
    : 0

  const ALL_KEEPERS_MODE_LABELS: Record<AllKeepersMode, string> = {
    'with-ghost': 'All keepers (with ghost)',
    'no-ghost': 'All keepers (no ghost)',
  }
  const ALL_KEEPERS_MODE_HINTS: Record<AllKeepersMode, string> = {
    'with-ghost': 'All keepers on this phrase together, ghost audible — check the stack against the lead.',
    'no-ghost': 'All keepers on this phrase together, ghost muted — check the blend on its own.',
  }

  return (
    <section className="mt-8 max-w-3xl" aria-label="Take review">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col items-start gap-1 text-sm">
          <span className="text-ink-muted">Phrase</span>
          <select
            aria-label="Phrase"
            value={phraseFilter}
            onChange={(event) => {
              const value = event.target.value
              setPhraseFilter(value)
              onSelectPhrase?.(value || null)
            }}
            className="rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm studio-transition hover:border-ink/40"
          >
            <option value="">All phrases</option>
            {phrases.map((phrase) => (
              <option key={phrase.id} value={phrase.id}>
                {phrase.name}
              </option>
            ))}
          </select>
        </label>
        {phraseFilter
          ? (['with-ghost', 'no-ghost'] as const).map((mode) => {
              const active =
                playing?.kind === 'phrase' &&
                playing.phraseId === phraseFilter &&
                playing.mode === mode
              return (
                <button
                  key={mode}
                  type="button"
                  className={buttonClass}
                  aria-pressed={active}
                  disabled={keeperCountForFilter === 0}
                  title={
                    keeperCountForFilter === 0
                      ? 'No keepers on this phrase yet'
                      : ALL_KEEPERS_MODE_HINTS[mode]
                  }
                  onClick={() =>
                    active ? onStop?.() : onPlayAllKeepers(phraseFilter, mode)
                  }
                >
                  {active ? `Stop — ${ALL_KEEPERS_MODE_LABELS[mode]}` : ALL_KEEPERS_MODE_LABELS[mode]}
                </button>
              )
            })
          : null}
      </div>
      {takes.length === 0 ? (
        <p className="mt-6 text-ink-muted">No takes yet</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {takes.map((item) => {
            const part = partsById.get(item.voicePartId)
            const phrase = phrases.find((row) => row.id === item.phraseId)
            return (
              <li key={item.id} className="rounded-md border border-ink/10 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-medium">
                    {part?.shortLabel ?? item.voicePartId} · {phrase?.name ?? 'phrase'} · take{' '}
                    {item.takeIndex}
                  </p>
                  <p className="text-sm text-ink-muted">{ratingLabel(item.rating)}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(['ghost', 'solo'] as const).map((mode) => {
                    const active = playing?.kind === 'take' && playing.takeId === item.id && playing.mode === mode
                    return (
                      <button
                        key={mode}
                        type="button"
                        className={buttonClass}
                        aria-pressed={active}
                        onClick={() => (active ? onStop?.() : onPlayTake(item.id, mode))}
                      >
                        {active ? `Stop — ${TAKE_MODE_LABELS[mode]}` : TAKE_MODE_LABELS[mode]}
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    className={buttonClass}
                    aria-pressed={item.rating === 'scratch'}
                    onClick={() => onRate(item.id, 'scratch')}
                  >
                    Scratch
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    aria-pressed={item.rating === 'keeper'}
                    onClick={() => onRate(item.id, 'keeper')}
                  >
                    Keeper
                  </button>
                  {STAR_RATINGS.map((star) => (
                    <button
                      key={star}
                      type="button"
                      className={buttonClass}
                      aria-label={`Rate ${star}`}
                      aria-pressed={item.rating === star}
                      onClick={() => onRate(item.id, star)}
                    >
                      {star}
                    </button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
