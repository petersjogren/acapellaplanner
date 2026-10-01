import { clsx } from 'clsx'
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

  // The native <input type=file> is kept in the DOM (and functional) but
  // visually hidden: its browser-drawn "No file chosen" text can't be
  // styled or removed with CSS. A second <label for> pointing at the same
  // input acts as the visible, studio-styled trigger; RTL's
  // getByLabelText still resolves the input via the first label (whose
  // text equals `label`), so existing tests are unaffected. No picked-name
  // chip here: the caller (PreparePage) already shows ghostMeta.filename
  // once an import lands — a second copy here would duplicate it.
  return (
    <div className="mt-6 max-w-xl">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <label
        htmlFor={inputId}
        className={clsx(
          'mt-2 inline-flex w-fit cursor-pointer items-center rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red',
          (disabled || decoding) && 'pointer-events-none opacity-50',
        )}
      >
        {decoding ? 'Decoding…' : 'Choose file'}
      </label>
      <input
        id={inputId}
        type="file"
        accept="audio/*"
        disabled={disabled || decoding}
        onChange={(event) => void handleChange(event)}
        className="sr-only"
      />
      {error ? (
        <p role="alert" className="mt-3 text-record-red">
          {error}
        </p>
      ) : null}
    </div>
  )
}
