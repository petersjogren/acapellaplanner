import { cellKey, deriveCompletion } from '../../domain/completion.ts'
import type { Project } from '../../domain/schemas.ts'

export const EMPTY_MATRIX_COPY = "Mark phrases and add voice parts to see what's left."

export type CompletionMatrixProps = {
  project: Project
}

function keeperLabel(count: number): string {
  return count === 1 ? '1 keeper' : `${count} keepers`
}

export function CompletionMatrix({ project }: CompletionMatrixProps) {
  const parts = project.voiceRoster.filter((item) => !item.isGhost)
  const phrases = project.phrases
  const completion = deriveCompletion(project)
  const cellsByKey = new Map(
    completion.cells.map((cell) => [cellKey(cell.phraseId, cell.voicePartId), cell]),
  )

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
                {phrases.map((phrase) => (
                  <th
                    key={phrase.id}
                    scope="col"
                    className="px-2 py-2 text-left font-medium"
                  >
                    {phrase.name}
                  </th>
                ))}
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
                    const cell = cellsByKey.get(cellKey(phrase.id, part.id))
                    const takeCount = cell?.takeCount ?? 0
                    const keeperCount = cell?.keeperCount ?? 0
                    const plan = phrase.partPlan.find((item) => item.voicePartId === part.id)
                    const targetTakes = plan?.targetTakes ?? part.targetTakes
                    const rest = Math.max(0, takeCount - keeperCount)
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
                            {Array.from({ length: keeperCount }, (_, index) => (
                              <span
                                key={`keeper-${index}`}
                                className="h-2 w-2 rounded-pill bg-gold"
                                aria-label={index === 0 ? keeperLabel(keeperCount) : undefined}
                              />
                            ))}
                            {Array.from({ length: rest }, (_, index) => (
                              <span
                                key={`take-${index}`}
                                className="h-2 w-2 rounded-pill bg-ink/35"
                                aria-hidden
                              />
                            ))}
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
