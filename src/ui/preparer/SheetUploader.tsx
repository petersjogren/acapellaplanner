import { clsx } from 'clsx'
import { useId, useState, type ChangeEvent } from 'react'

export type SheetUploadResult = {
  blob: Blob
  filename: string
}

export type SheetUploaderProps = {
  onUploaded: (result: SheetUploadResult) => void | Promise<void>
  label?: string
  disabled?: boolean
}

function messageFrom(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function SheetUploader({
  onUploaded,
  label = 'Upload sheet PDF',
  disabled = false,
}: SheetUploaderProps) {
  const inputId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickedName, setPickedName] = useState<string | null>(null)

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setBusy(true)
    setError(null)
    try {
      await onUploaded({
        blob: file,
        filename: file.name || 'sheet.pdf',
      })
      // Only reveal the picked name once onUploaded has actually resolved —
      // see GhostImporter.tsx for why.
      setPickedName(file.name || null)
    } catch (err: unknown) {
      setError(messageFrom(err, 'Could not open PDF'))
    } finally {
      setBusy(false)
    }
  }

  // See GhostImporter.tsx for why the native input is sr-only with a
  // second styled <label for> as the visible trigger.
  return (
    <div className="mt-4 max-w-xl">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label
          htmlFor={inputId}
          className={clsx(
            'inline-flex w-fit cursor-pointer items-center rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red',
            (disabled || busy) && 'pointer-events-none opacity-50',
          )}
        >
          {busy ? 'Opening…' : 'Choose file'}
        </label>
        {pickedName ? (
          <span className="rounded-md bg-ink/5 px-2 py-1 text-xs text-ink-muted">{pickedName}</span>
        ) : null}
      </div>
      <input
        id={inputId}
        type="file"
        accept="application/pdf"
        disabled={disabled || busy}
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
