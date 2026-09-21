import { builtinMixPresets, mixPresetDescription } from '../../audio/mix.ts'

export type MixPresetSelectProps = {
  value: string
  onChange: (id: string) => void
  /** Hide the description paragraph — dock chrome. */
  compact?: boolean
}

export function MixPresetSelect({ value, onChange, compact = false }: MixPresetSelectProps) {
  const description = mixPresetDescription(value)
  return (
    <div className="flex flex-col items-start gap-1">
      <label className="flex flex-col items-start gap-1 text-sm">
        <span className="text-ink-muted">Headphones</span>
        <select
          aria-label="Headphones"
          title={compact ? description : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="rounded-md border border-ink/15 bg-paper px-3 py-2 text-sm studio-transition hover:border-ink/40"
        >
          {builtinMixPresets().map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>
      {compact ? null : <p className="max-w-xs text-sm text-ink-muted">{description}</p>}
    </div>
  )
}
