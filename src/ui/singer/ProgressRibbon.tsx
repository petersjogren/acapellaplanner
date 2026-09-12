export type ProgressRibbonProps = {
  takeCount: number
  targetTakes: number
  sungPhrases: number
  phraseCount: number
  partName: string
}

export function ProgressRibbon({
  takeCount,
  targetTakes,
  sungPhrases,
  phraseCount,
  partName,
}: ProgressRibbonProps) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-ink-muted" aria-label="Progress">
      <p>
        This phrase · {takeCount} / {targetTakes}
      </p>
      <p>
        {partName} · {sungPhrases} of {phraseCount} phrases
      </p>
    </div>
  )
}
