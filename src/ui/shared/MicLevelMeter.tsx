export type MicLevelMeterProps = {
  level: number
  living: boolean
  label?: string
}

function clamp01(level: number): number {
  return Math.min(1, Math.max(0, level))
}

export function MicLevelMeter({ level, living, label }: MicLevelMeterProps) {
  const clamped = clamp01(level)
  const percent = Math.round(clamped * 100)

  return (
    <div className="flex w-full max-w-xs flex-col items-start gap-1">
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={clamped}
        aria-label={label ?? 'Microphone level'}
        className="h-2 w-full overflow-hidden rounded-pill bg-ink/10"
      >
        <div className="h-full bg-ink" style={{ width: `${percent}%` }} />
      </div>
      <span className="text-sm text-ink-muted">{living ? 'living' : 'quiet'}</span>
    </div>
  )
}
