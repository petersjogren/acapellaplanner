import { useId, useState, type FormEvent } from 'react'
import type { NewSectionInput } from '../../domain/sections.ts'
import type { Section } from '../../domain/schemas.ts'

export type SectionEditorProps = {
  sections: Section[]
  durationMs?: number
  onAddSection: (input: NewSectionInput) => void | Promise<void>
  onRemoveSection?: (id: string) => void | Promise<void>
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function parseMs(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseBpm(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function timeFeelLabel(mode: Section['timeMode']): string {
  return mode === 'fixed-tempo' ? 'In time' : 'Follow the ghost'
}

export function SectionEditor({
  sections,
  durationMs = 0,
  onAddSection,
  onRemoveSection,
}: SectionEditorProps) {
  const timeFeelId = useId()
  const [name, setName] = useState('')
  const [timeMode, setTimeMode] = useState<Section['timeMode']>('ghost-follow')
  const [bpm, setBpm] = useState('120')
  const [clickEnabled, setClickEnabled] = useState(false)
  const [startMs, setStartMs] = useState('0')
  const [endMs, setEndMs] = useState(String(durationMs))
  const [error, setError] = useState<string | null>(null)

  const inTime = timeMode === 'fixed-tempo'

  async function handleAdd(event?: FormEvent) {
    event?.preventDefault()
    const nextName = name.trim()
    if (!nextName) return
    try {
      await onAddSection({
        name: nextName,
        timeMode,
        fixedBpm: inTime ? parseBpm(bpm) : undefined,
        startMs: parseMs(startMs, 0),
        endMs: parseMs(endMs, durationMs),
        clickEnabled: inTime && clickEnabled,
      })
      setError(null)
      setName('')
      setClickEnabled(false)
    } catch (err: unknown) {
      setError(messageFrom(err, 'Could not add section'))
    }
  }

  return (
    <section className="mt-10 max-w-3xl" aria-label="Sections">
      <h3 className="font-medium">Sections</h3>
      <p className="mt-1 text-sm text-ink-muted">
        Mark a stretch as In time or Follow the ghost. Click only plays inside in-time sections.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-record-red">
          {error}
        </p>
      ) : null}
      {sections.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">No sections yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2" aria-label="Section list">
          {sections.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink/10 px-3 py-2"
            >
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="text-sm text-ink-muted">
                  {timeFeelLabel(item.timeMode)}
                  {item.timeMode === 'fixed-tempo' && item.fixedBpm ? ` · ${item.fixedBpm} BPM` : ''}
                  {item.clickEnabled ? ' · click' : ''}
                  {` · ${item.startMs}–${item.endMs} ms`}
                </p>
              </div>
              {onRemoveSection ? (
                <button
                  type="button"
                  className="rounded-md border border-ink/15 px-3 py-1 text-sm studio-transition hover:bg-ink/5"
                  onClick={() => void onRemoveSection(item.id)}
                  aria-label={`Delete ${item.name}`}
                >
                  Delete
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <form className="mt-6 grid gap-3 sm:grid-cols-2" onSubmit={(event) => void handleAdd(event)}>
        <label className="flex flex-col gap-1 text-sm">
          Section name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-ink/15 bg-paper px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Time feel
          <select
            id={timeFeelId}
            aria-label="Time feel"
            value={timeMode}
            onChange={(event) => setTimeMode(event.target.value as Section['timeMode'])}
            className="rounded-md border border-ink/15 bg-paper px-2 py-1"
          >
            <option value="ghost-follow">Follow the ghost</option>
            <option value="fixed-tempo">In time</option>
          </select>
        </label>
        {inTime ? (
          <label className="flex flex-col gap-1 text-sm">
            BPM
            <input
              type="number"
              min={1}
              value={bpm}
              onChange={(event) => setBpm(event.target.value)}
              className="rounded-md border border-ink/15 bg-paper px-2 py-1"
            />
          </label>
        ) : null}
        {inTime ? (
          <label className="flex items-center gap-2 text-sm sm:mt-6">
            <input
              type="checkbox"
              checked={clickEnabled}
              onChange={(event) => setClickEnabled(event.target.checked)}
            />
            Click
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-sm">
          Start (ms)
          <input
            type="number"
            value={startMs}
            onChange={(event) => setStartMs(event.target.value)}
            className="rounded-md border border-ink/15 bg-paper px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          End (ms)
          <input
            type="number"
            value={endMs}
            onChange={(event) => setEndMs(event.target.value)}
            className="rounded-md border border-ink/15 bg-paper px-2 py-1"
          />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-record-red studio-transition"
          >
            Add section
          </button>
        </div>
      </form>
    </section>
  )
}
