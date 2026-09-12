import { useState, type FormEvent } from 'react'
import {
  DEFAULT_TARGET_TAKES,
  duplicateShortLabelMessage,
  isDuplicateShortLabel,
  type NewVoicePartInput,
  type VoicePartPatch,
} from '../../domain/roster.ts'
import type { VoicePart } from '../../domain/schemas.ts'

export const VOICE_PART_SWATCHES = [
  { color: '#c23b2a', name: 'Record red' },
  { color: '#c4a35a', name: 'Gold' },
  { color: '#3f5d4a', name: 'Forest' },
  { color: '#4d6a8f', name: 'Slate' },
  { color: '#8c5a3c', name: 'Umber' },
  { color: '#6a4c7d', name: 'Plum' },
  { color: '#1c1916', name: 'Ink' },
] as const

const DEFAULT_COLOR = VOICE_PART_SWATCHES[0].color

export type VoiceRosterEditorProps = {
  parts: VoicePart[]
  onAddPart: (partial: NewVoicePartInput) => void | Promise<void>
  onUpdatePart: (id: string, patch: VoicePartPatch) => void | Promise<void>
  onRemovePart: (id: string) => void | Promise<void>
}

function parseTargetTakes(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TARGET_TAKES
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function ColorSwatches({
  value,
  onChange,
  labelledBy,
}: {
  value: string
  onChange: (color: string) => void
  labelledBy: string
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {VOICE_PART_SWATCHES.map((swatch) => {
        const selected = value === swatch.color
        return (
          <button
            key={swatch.color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={swatch.name}
            onClick={() => onChange(swatch.color)}
            className="h-7 w-7 rounded-pill border border-ink/15 studio-transition"
            style={{
              backgroundColor: swatch.color,
              boxShadow: selected ? `0 0 0 2px var(--paper), 0 0 0 4px ${swatch.color}` : undefined,
            }}
          />
        )
      })}
    </div>
  )
}

function PartRow({
  part,
  parts,
  onUpdatePart,
  onRemovePart,
  onError,
}: {
  part: VoicePart
  parts: VoicePart[]
  onUpdatePart: VoiceRosterEditorProps['onUpdatePart']
  onRemovePart: VoiceRosterEditorProps['onRemovePart']
  onError: (message: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(part.name)
  const [shortLabel, setShortLabel] = useState(part.shortLabel)
  const [color, setColor] = useState(part.color)
  const [targetTakes, setTargetTakes] = useState(String(part.targetTakes))

  async function commitEdit() {
    const nextName = name.trim()
    const nextShort = shortLabel.trim()
    if (!nextName || !nextShort) return
    if (isDuplicateShortLabel(parts, nextShort, part.id)) {
      onError(duplicateShortLabelMessage(nextShort))
      return
    }
    try {
      await onUpdatePart(part.id, {
        name: nextName,
        shortLabel: nextShort,
        color,
        targetTakes: parseTargetTakes(targetTakes),
      })
      onError(null)
      setEditing(false)
    } catch (error: unknown) {
      onError(messageFrom(error, 'Could not update part'))
    }
  }

  function requestDelete() {
    const confirmed = window.confirm(
      `Delete ${part.name}? Recorded takes for this part will also be removed.`,
    )
    if (!confirmed) return
    void (async () => {
      try {
        await onRemovePart(part.id)
        onError(null)
      } catch (error: unknown) {
        onError(messageFrom(error, 'Could not delete part'))
      }
    })()
  }

  if (!editing) {
    return (
      <li className="flex flex-wrap items-center gap-3 rounded-md border border-ink/10 px-3 py-2">
        <span
          className="h-3 w-3 shrink-0 rounded-pill"
          style={{ backgroundColor: part.color }}
          aria-hidden
        />
        <span className="font-medium">{part.name}</span>
        <span className="text-sm text-ink-muted">{part.shortLabel}</span>
        <span className="text-sm text-ink-muted">Target doubles {part.targetTakes}</span>
        <div className="ml-auto flex gap-3">
          <button
            type="button"
            className="text-sm studio-transition hover:text-record-red"
            aria-label={`Edit ${part.name}`}
            onClick={() => {
              setName(part.name)
              setShortLabel(part.shortLabel)
              setColor(part.color)
              setTargetTakes(String(part.targetTakes))
              setEditing(true)
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="text-sm text-record-red"
            aria-label={`Delete ${part.name}`}
            onClick={requestDelete}
          >
            Delete
          </button>
        </div>
      </li>
    )
  }

  const colorLegendId = `edit-color-${part.id}`

  return (
    <li className="rounded-md border border-ink/10 px-3 py-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Part name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-ink/15 bg-paper px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Short label
          <input
            value={shortLabel}
            onChange={(event) => setShortLabel(event.target.value)}
            className="rounded-md border border-ink/15 bg-paper px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Target doubles
          <input
            type="number"
            min={1}
            value={targetTakes}
            onChange={(event) => setTargetTakes(event.target.value)}
            className="rounded-md border border-ink/15 bg-paper px-2 py-1"
          />
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <span id={colorLegendId}>Color</span>
          <ColorSwatches value={color} onChange={setColor} labelledBy={colorLegendId} />
        </div>
      </div>
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          className="rounded-md bg-ink px-3 py-1 text-sm font-medium text-paper"
          onClick={() => void commitEdit()}
        >
          Save part
        </button>
        <button type="button" className="text-sm text-ink-muted" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </li>
  )
}

export function VoiceRosterEditor({
  parts,
  onAddPart,
  onUpdatePart,
  onRemovePart,
}: VoiceRosterEditorProps) {
  const [name, setName] = useState('')
  const [shortLabel, setShortLabel] = useState('')
  const [color, setColor] = useState<string>(DEFAULT_COLOR)
  const [targetTakes, setTargetTakes] = useState(String(DEFAULT_TARGET_TAKES))
  const [error, setError] = useState<string | null>(null)
  const addColorId = 'add-part-color'

  function handleAdd(event?: FormEvent) {
    event?.preventDefault()
    const nextName = name.trim()
    const nextShort = shortLabel.trim()
    if (!nextName || !nextShort) return
    if (isDuplicateShortLabel(parts, nextShort)) {
      setError(duplicateShortLabelMessage(nextShort))
      return
    }
    void (async () => {
      try {
        await onAddPart({
          name: nextName,
          shortLabel: nextShort,
          color,
          targetTakes: parseTargetTakes(targetTakes),
        })
        setError(null)
      } catch (err: unknown) {
        setError(messageFrom(err, 'Could not add part'))
      }
    })()
    setName('')
    setShortLabel('')
    setColor(DEFAULT_COLOR)
    setTargetTakes(String(DEFAULT_TARGET_TAKES))
  }

  return (
    <section className="mt-10 max-w-3xl" aria-label="Voice parts">
      <h3 className="font-medium">Voice parts</h3>
      <p className="mt-1 text-sm text-ink-muted">Name the parts that stack on the ghost.</p>
      {error ? (
        <p role="alert" className="mt-3 text-record-red">
          {error}
        </p>
      ) : null}
      {parts.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">No voice parts yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2" aria-label="Voice part list">
          {parts.map((part) => (
            <PartRow
              key={part.id}
              part={part}
              parts={parts}
              onUpdatePart={onUpdatePart}
              onRemovePart={onRemovePart}
              onError={setError}
            />
          ))}
        </ul>
      )}
      <form className="mt-6 grid gap-3 sm:grid-cols-2" onSubmit={handleAdd}>
        <label className="flex flex-col gap-1 text-sm">
          Part name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-ink/15 bg-paper px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Short label
          <input
            value={shortLabel}
            onChange={(event) => setShortLabel(event.target.value)}
            className="rounded-md border border-ink/15 bg-paper px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Target doubles
          <input
            type="number"
            min={1}
            value={targetTakes}
            onChange={(event) => setTargetTakes(event.target.value)}
            className="rounded-md border border-ink/15 bg-paper px-2 py-1"
          />
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <span id={addColorId}>Color</span>
          <ColorSwatches value={color} onChange={setColor} labelledBy={addColorId} />
        </div>
        <div className="sm:col-span-2">
          <button
            type="button"
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-record-red studio-transition"
            onClick={() => handleAdd()}
          >
            Add voice part
          </button>
        </div>
      </form>
    </section>
  )
}
