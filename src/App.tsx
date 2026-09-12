import { useState } from 'react'
import { PreparerShell } from './ui/shell/PreparerShell.tsx'
import { SingerShell } from './ui/shell/SingerShell.tsx'

export default function App() {
  const [boothOpen, setBoothOpen] = useState(false)

  if (boothOpen) {
    return (
      <SingerShell songTitle="When I Fall in Love" partLabel="Alto 2">
        <p className="font-display text-lyric leading-snug">The booth is quiet.</p>
        <p className="mt-3 max-w-md text-ink/70">
          Headphones carry the ghost. Sing the line when it comes.
        </p>
        <button
          type="button"
          className="mt-10 self-start rounded-pill bg-record-red px-6 py-3 font-medium text-paper record-lamp"
        >
          REC
        </button>
        <button
          type="button"
          className="mt-8 self-start text-sm text-ink-muted underline-offset-4 hover:underline"
          onClick={() => setBoothOpen(false)}
        >
          Back to the score desk
        </button>
      </SingerShell>
    )
  }

  return (
    <PreparerShell title="Acapella Planner">
      <p className="font-display text-xl font-semibold tracking-tight">Score desk</p>
      <p className="mt-3 max-w-xl text-ink/70">
        Mark phrases on the ghost, then send the singer to the booth.
      </p>
      <button
        type="button"
        className="mt-8 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper studio-transition hover:bg-record-red"
        onClick={() => setBoothOpen(true)}
      >
        Open booth
      </button>
    </PreparerShell>
  )
}
