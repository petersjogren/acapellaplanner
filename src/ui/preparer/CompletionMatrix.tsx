import { cellKey } from '../../domain/completion.ts'
import { takeCoversPhrase } from '../../domain/singThrough.ts'
import type { Project, Take } from '../../domain/schemas.ts'

export const EMPTY_MATRIX_COPY = "Mark phrases and add voice parts to see what's left."

export type CompletionMatrixProps = {
  project: Project
  /** Phrase currently auditioned via its column-header press (ghost + stack, per the Headphones preset). */
  playingPhraseId?: string | null
  /** Take currently auditioned solo via its dot press. */
  playingTakeId?: string | null
  onPlayPhrase?: (phraseId: string) => void
  onPlayTake?: (takeId: string, phraseId: string) => void
}

export function CompletionMatrix({
  project,
  playingPhraseId = null,
  playingTakeId = null,
  onPlayPhrase,
  onPlayTake,
}: CompletionMatrixProps) {
  const parts = project.voiceRoster.filter((item) => !item.isGhost)
  const phrases = project.phrases

  // Chronological by takeIndex (recording order) so a dot's position is a
  // stable, predictable mapping to one take — not grouped keeper-first.
  const takesByCell = new Map<string, Take[]>()
  for (const phrase of phrases) {
    for (const part of parts) {
      const cellTakes = project.takes
        .filter((item) => item.voicePartId === part.id && takeCoversPhrase(item, phrase.id))
        .slice()
        .sort((a, b) => a.takeIndex - b.takeIndex)
      takesByCell.set(cellKey(phrase.id, part.id), cellTakes)
    }
  }

  return (
    <section className="mt-10 max-w-4xl" aria-label="What's left">
      <h3 className="font-medium">What’s left</h3>
      {parts.length === 0 || phrases.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{EMPTY_MATRIX_COPY}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[24rem] border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="px-2 py-2 text-left font-medium text-ink-muted">
                  Voice part
                </th>
                {phrases.map((phrase) => {
                  const isPlaying = playingPhraseId === phrase.id
                  return (
                    <th key={phrase.id} scope="col" className="px-2 py-2 text-left font-medium">
                      <button
                        type="button"
                        aria-pressed={isPlaying}
                        title="Play this phrase (ghost + stack, per Headphones)"
                        className="font-medium studio-transition hover:text-record-red"
                        onClick={() => onPlayPhrase?.(phrase.id)}
                      >
                        {isPlaying ? `Stop — ${phrase.name}` : phrase.name}
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {parts.map((part) => (
                <tr key={part.id} className="border-t border-ink/10">
                  <th scope="row" className="px-2 py-3 text-left font-medium">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-pill"
                        style={{ backgroundColor: part.color }}
                        aria-hidden
                      />
                      {part.name}
                      <span className="font-normal text-ink-muted">{part.shortLabel}</span>
                    </span>
                  </th>
                  {phrases.map((phrase) => {
                    const cellTakes = takesByCell.get(cellKey(phrase.id, part.id)) ?? []
                    const takeCount = cellTakes.length
                    const plan = phrase.partPlan.find((item) => item.voicePartId === part.id)
                    const targetTakes = plan?.targetTakes ?? part.targetTakes
                    return (
                      <td
                        key={phrase.id}
                        className="px-2 py-3 align-top"
                        aria-label={`${part.shortLabel} / ${phrase.name}: ${takeCount} of ${targetTakes}`}
                      >
                        <span className="tabular-nums">
                          {takeCount}/{targetTakes}
                        </span>
                        {takeCount > 0 ? (
                          <span className="mt-1 flex flex-wrap items-center gap-1">
                            {cellTakes.map((take) => {
                              const isKeeper = take.rating === 'keeper'
                              const isPlaying = playingTakeId === take.id
                              const label = `${isPlaying ? 'Stop — ' : ''}Take ${take.takeIndex}${
                                isKeeper ? ' (keeper)' : ''
                              } — ${part.shortLabel} / ${phrase.name}`
                              return (
                                <button
                                  key={take.id}
                                  type="button"
                                  aria-pressed={isPlaying}
                                  aria-label={label}
                                  title="Play this take, solo"
                                  className={`h-2.5 w-2.5 rounded-pill studio-transition ${
                                    isKeeper ? 'bg-gold' : 'bg-ink/35'
                                  } ${isPlaying ? 'ring-2 ring-ink ring-offset-1' : ''}`}
                                  onClick={() => onPlayTake?.(take.id, phrase.id)}
                                />
                              )
                            })}
                          </span>
                        ) : null}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
