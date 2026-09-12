import type {
  CompletionCell,
  CompletionState,
  PhrasePartStatus,
  Project,
} from './schemas.ts'

export function cellKey(phraseId: string, voicePartId: string): string {
  return `${phraseId}:${voicePartId}`
}

function derivedStatus(takeCount: number, targetTakes: number): PhrasePartStatus {
  if (takeCount === 0) return 'not-started'
  if (takeCount < targetTakes) return 'in-progress'
  return 'enough'
}

export function deriveCompletion(project: Project): CompletionState {
  const parts = project.voiceRoster.filter((item) => !item.isGhost)
  const cells: CompletionCell[] = []

  for (const phrase of project.phrases) {
    for (const part of parts) {
      const matchingTakes = project.takes.filter(
        (item) => item.phraseId === phrase.id && item.voicePartId === part.id,
      )
      const takeCount = matchingTakes.length
      const keeperCount = matchingTakes.filter((item) => item.rating === 'keeper').length
      const plan = phrase.partPlan.find((item) => item.voicePartId === part.id)
      const targetTakes = plan?.targetTakes ?? part.targetTakes
      const derived = derivedStatus(takeCount, targetTakes)

      let status = derived
      if (plan?.status === 'final') {
        status = 'final'
      } else if (plan?.status === 'enough' && takeCount >= targetTakes) {
        status = 'enough'
      }

      cells.push({
        phraseId: phrase.id,
        voicePartId: part.id,
        takeCount,
        keeperCount,
        status,
      })
    }
  }

  return { cells }
}
