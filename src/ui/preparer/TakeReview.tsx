import { useState } from 'react'
import type { Project, TakeRating } from '../../domain/schemas.ts'
import { MixPresetSelect } from '../shared/MixPresetSelect.tsx'

export type TakeReviewProps = {
  project: Project
  selectedPhraseId?: string | null
  onSelectPhrase?: (id: string | null) => void
  onRate: (takeId: string, rating: TakeRating) => void
  onPlay: (takeId: string) => void
  onStop?: () => void
  playingTakeId?: string | null
  mixPresetId?: string
  onMixChange?: (id: string) => void
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

export function TakeReview({
  project,
  selectedPhraseId = null,
  onSelectPhrase,
  onRate,
  onPlay,
  onStop,
  playingTakeId = null,
  mixPresetId,
  onMixChange,
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

  return (
    <section className="mt-8 max-w-3xl" aria-label="Take review">
      <div className="flex flex-wrap items-end gap-4">
        {mixPresetId && onMixChange ? (
          <MixPresetSelect value={mixPresetId} onChange={onMixChange} />
        ) : null}
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
      </div>
      {takes.length === 0 ? (
        <p className="mt-6 text-ink-muted">No takes yet</p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {takes.map((item) => {
            const part = partsById.get(item.voicePartId)
            const phrase = phrases.find((row) => row.id === item.phraseId)
            const playing = playingTakeId === item.id
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
                  <button
                    type="button"
                    className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-paper studio-transition hover:bg-record-red"
                    onClick={() => (playing ? onStop?.() : onPlay(item.id))}
                  >
                    {playing ? 'Stop' : 'Play'}
                  </button>
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
