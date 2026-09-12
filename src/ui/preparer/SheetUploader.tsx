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
    } catch (err: unknown) {
      setError(messageFrom(err, 'Could not open PDF'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 max-w-xl">
      <label htmlFor={inputId} className="flex flex-col gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <input
          id={inputId}
          type="file"
          accept="application/pdf"
          disabled={disabled || busy}
          onChange={(event) => void handleChange(event)}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-4 file:py-2 file:font-medium file:text-paper hover:file:bg-record-red disabled:opacity-50"
        />
      </label>
      {busy ? <p className="mt-3 text-sm text-ink-muted">Opening PDF…</p> : null}
      {error ? (
        <p role="alert" className="mt-3 text-record-red">
          {error}
        </p>
      ) : null}
    </div>
  )
}
