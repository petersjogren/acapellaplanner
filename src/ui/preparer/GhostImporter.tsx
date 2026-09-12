import { useId, useState, type ChangeEvent } from 'react'
import { decodeAudioFile } from '../../audio/decode.ts'

export type GhostImportMeta = {
  filename: string
  durationMs: number
  sampleRate: number
}

export type GhostImportResult = {
  blob: Blob
  meta: GhostImportMeta
}

export type GhostImporterProps = {
  onImported: (result: GhostImportResult) => void | Promise<void>
  label?: string
  disabled?: boolean
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function GhostImporter({
  onImported,
  label = 'Import ghost track',
  disabled = false,
}: GhostImporterProps) {
  const inputId = useId()
  const [decoding, setDecoding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setDecoding(true)
    setError(null)
    try {
      // Decodes on the playback singleton AudioContext (decodeAudioFile default).
      const decoded = await decodeAudioFile(file)
      await onImported({
        blob: file,
        meta: {
          filename: file.name || 'ghost',
          durationMs: decoded.durationMs,
          sampleRate: decoded.sampleRate,
        },
      })
    } catch (err: unknown) {
      setError(messageFrom(err, 'Could not decode audio file'))
    } finally {
      setDecoding(false)
    }
  }

  return (
    <div className="mt-6 max-w-xl">
      <label htmlFor={inputId} className="flex flex-col gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <input
          id={inputId}
          type="file"
          accept="audio/*"
          disabled={disabled || decoding}
          onChange={(event) => void handleChange(event)}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-4 file:py-2 file:font-medium file:text-paper hover:file:bg-record-red disabled:opacity-50"
        />
      </label>
      {decoding ? <p className="mt-3 text-sm text-ink-muted">Decoding…</p> : null}
      {error ? (
        <p role="alert" className="mt-3 text-record-red">
          {error}
        </p>
      ) : null}
    </div>
  )
}
