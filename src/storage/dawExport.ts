/** Filesystem-safe path segment. Strips accents so Swedish part names survive. */
export function safeSegment(text: string): string {
  const cleaned = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'part'
}

/** Lane suffix. Letters read better on a DAW track name than numbers do. */
export function laneLetter(laneIndex: number): string {
  if (laneIndex < 0 || laneIndex >= 26) return `L${laneIndex + 1}`
  return String.fromCharCode(65 + laneIndex)
}

export function lanePath(partName: string, laneIndex: number): string {
  const folder = safeSegment(partName)
  return `${folder}/${folder}_${laneLetter(laneIndex)}.wav`
}

export type StemName = {
  partName: string
  shortLabel: string
  phraseIndex: number
  takeIndex: number
}

export function stemPath({ partName, shortLabel, phraseIndex, takeIndex }: StemName): string {
  return `${safeSegment(partName)}/${safeSegment(shortLabel)}_p${phraseIndex}_t${takeIndex}.wav`
}
