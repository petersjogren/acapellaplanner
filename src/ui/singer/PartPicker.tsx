import type { VoicePart } from '../../domain/schemas.ts'

export type PartPickerProps = {
  parts: VoicePart[]
  onPick: (voicePartId: string) => void
  onSurprise: () => void
}

export function PartPicker({ parts, onPick, onSurprise }: PartPickerProps) {
  return (
    <section className="flex max-w-lg flex-col gap-6" aria-label="Choose a part">
      <p className="font-display text-lyric leading-snug">Who is singing?</p>
      <p className="text-ink/70">Pick a part, or let the booth choose what’s left.</p>
      <div className="flex flex-col gap-3">
        {parts.map((part) => (
          <button
            key={part.id}
            type="button"
            onClick={() => onPick(part.id)}
            className="flex items-center gap-4 rounded-lg border border-ink/15 bg-paper px-5 py-4 text-left studio-transition hover:border-ink/40"
          >
            <span
              className="flex h-12 min-w-12 items-center justify-center rounded-pill px-3 text-sm font-medium text-paper"
              style={{ backgroundColor: part.color }}
            >
              {part.shortLabel}
            </span>
            <span className="font-display text-xl tracking-tight">{part.name}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onSurprise}
        className="self-start text-sm text-ink-muted underline-offset-4 hover:underline"
      >
        Surprise me with what’s left
      </button>
    </section>
  )
}
