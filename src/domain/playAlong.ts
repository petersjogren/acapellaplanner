import { sortPhrases } from './phrases.ts'
import { phrasesInSection, sectionForPhrase } from './sections.ts'
import type { Phrase, Section } from './schemas.ts'

export type PlayAlongLoopMode = 'off' | 'phrase' | 'section'

export type PlayAlongWindow = {
  startMs: number
  endMs: number
  loop: boolean
  gapMs: number
}

/**
 * Phrase the sheet should show at ghost time `ms`.
 *
 * Inside a phrase: that phrase. In a gap (or after the last phrase): the
 * previous one, so the cue stays put instead of flashing blank. Before the
 * first phrase: the first one, pinned at its start.
 */
export function phraseForPlayhead<T extends { startMs: number; endMs: number }>(
  phrases: T[],
  ms: number,
): T | undefined {
  const ordered = sortPhrases(phrases)
  if (ordered.length === 0) return undefined
  let previous: T | undefined
  for (const phrase of ordered) {
    if (ms < phrase.startMs) return previous ?? phrase
    if (ms < phrase.endMs) return phrase
    previous = phrase
  }
  return previous
}

/**
 * Play/Practice window on the ghost clock. Play mode is follow-along, not
 * recording, so windows use phrase boundaries — not pre/post-roll.
 *
 * - `off`: `[fromMs, ghostDuration]` once. `fromMs` is the jump/resume point.
 * - `phrase`: selected phrase, looping, gap from `loopDefault.gapMs`.
 * - `section`: the section that contains the selected phrase, looping; falls
 *   back to phrase-loop when the phrase is not in a section.
 *
 * `null` when there is nothing audible (empty ghost, or resume past the end).
 */
export function playAlongWindow(args: {
  loopMode: PlayAlongLoopMode
  phrases: Phrase[]
  sections: Section[]
  selectedPhraseId: string | null
  ghostDurationMs: number
  fromMs?: number
}): PlayAlongWindow | null {
  const ghostDurationMs = Math.max(0, args.ghostDurationMs)
  if (!(ghostDurationMs > 0) && args.loopMode === 'off') return null

  if (args.loopMode === 'off') {
    const startMs = Math.min(Math.max(0, args.fromMs ?? 0), ghostDurationMs)
    if (!(ghostDurationMs > startMs)) return null
    return { startMs, endMs: ghostDurationMs, loop: false, gapMs: 0 }
  }

  const ordered = sortPhrases(args.phrases)
  const selected =
    ordered.find((item) => item.id === args.selectedPhraseId) ?? ordered[0]
  if (!selected) return null

  if (args.loopMode === 'section') {
    const section = sectionForPhrase(selected.id, args.sections, args.phrases)
    if (section) {
      const members = phrasesInSection(section, args.phrases)
      const first = members[0]
      const last = members[members.length - 1]
      if (first && last && last.endMs > first.startMs) {
        return {
          startMs: first.startMs,
          endMs: last.endMs,
          loop: true,
          gapMs: first.loopDefault.gapMs,
        }
      }
    }
  }

  if (!(selected.endMs > selected.startMs)) return null
  return {
    startMs: selected.startMs,
    endMs: selected.endMs,
    loop: true,
    gapMs: selected.loopDefault.gapMs,
  }
}
