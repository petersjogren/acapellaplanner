import type { RegionNorm } from './schemas.ts'
import { MIN_REGION_NORM } from './sheets.ts'

export const paperEstimate = {
  paperPercentile: 0.9,
  inkDeltaMin: 16,
  inkDeltaFrac: 0.08,
  localBlock: 32,
} as const

const staffDetect = {
  edgeIgnore: 0.02,
  staffLineMin: 0.45,
  staffLineClusterPx: 2,
  spacingSlack: 1.6,
  padFrac: 0.004,
  connectorZoneFrac: 0.12,
  connectorCoverage: 0.35,
} as const

const gutterInkMax = 0.008
const gutterMinWidthFrac = 0.015
/** A side of a gutter must have a real ink column, not a one-pixel title. */
const gutterSideInkMin = 0.02

const MIN_STAFF_LINES = 4
const MAX_STAFF_LINES = 6
const MIN_LINE_SPACING = 3

export type PageInk = {
  width: number
  height: number
  dark: Uint8Array
}

function luminance(r: number, g: number, b: number, a: number): number {
  if (a === 0) return 255
  return (r + g + b) / 3
}

/** Nearest-rank percentile. The 90th of a 4-sample page is the max. */
function percentile(sorted: Float64Array, p: number): number {
  const n = sorted.length
  if (n === 0) return 255
  const index = Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))
  return sorted[index]!
}

function blockCenters(size: number, block: number): number[] {
  const count = Math.ceil(size / block)
  const centers: number[] = []
  for (let b = 0; b < count; b++) {
    const start = b * block
    const end = Math.min(size, start + block)
    centers.push((start + end - 1) / 2)
  }
  return centers
}

function nearestBlockAt(size: number, centers: readonly number[]): Int32Array {
  const nearest = new Int32Array(size)
  for (let i = 0; i < size; i++) {
    let best = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let b = 0; b < centers.length; b++) {
      const delta = i - centers[b]!
      const dist = delta * delta
      if (dist < bestDist) {
        bestDist = dist
        best = b
      }
    }
    nearest[i] = best
  }
  return nearest
}

function localPaperGrid(luma: Float64Array, width: number, height: number): Float64Array {
  const block = paperEstimate.localBlock
  const blocksX = Math.ceil(width / block)
  const blocksY = Math.ceil(height / block)
  const grid = new Float64Array(blocksX * blocksY)
  for (let by = 0; by < blocksY; by++) {
    const y0 = by * block
    const y1 = Math.min(height, y0 + block)
    for (let bx = 0; bx < blocksX; bx++) {
      const x0 = bx * block
      const x1 = Math.min(width, x0 + block)
      const samples = new Float64Array((x1 - x0) * (y1 - y0))
      let s = 0
      for (let y = y0; y < y1; y++) {
        const row = y * width
        for (let x = x0; x < x1; x++) samples[s++] = luma[row + x]!
      }
      samples.sort()
      grid[by * blocksX + bx] = percentile(samples, paperEstimate.paperPercentile)
    }
  }
  return grid
}

export function pageInkFromRgba(width: number, height: number, rgba: Uint8ClampedArray): PageInk {
  const count = width * height
  const dark = new Uint8Array(count)
  if (width <= 0 || height <= 0) return { width, height, dark }

  const luma = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    const o = i * 4
    luma[i] = luminance(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!, rgba[o + 3]!)
  }

  const sorted = new Float64Array(luma)
  sorted.sort()
  const globalPaper = percentile(sorted, paperEstimate.paperPercentile)
  const delta = Math.max(paperEstimate.inkDeltaMin, paperEstimate.inkDeltaFrac * globalPaper)

  const block = paperEstimate.localBlock
  const blocksX = Math.ceil(width / block)
  const localPaper = localPaperGrid(luma, width, height)
  const nearestX = nearestBlockAt(width, blockCenters(width, block))
  const nearestY = nearestBlockAt(height, blockCenters(height, block))

  for (let y = 0; y < height; y++) {
    const by = nearestY[y]!
    const row = y * width
    for (let x = 0; x < width; x++) {
      const i = row + x
      const o = i * 4
      if (rgba[o + 3] === 0) continue
      const value = luma[i]!
      const local = localPaper[by * blocksX + nearestX[x]!]!
      const darkerThanGlobal = globalPaper - value >= delta
      const darkerThanLocal = local - value >= delta
      if (darkerThanGlobal && darkerThanLocal) dark[i] = 1
    }
  }

  return { width, height, dark }
}

type XRange = { x0: number; x1: number }

type StaffSpan = {
  y0: number
  y1: number
  x0: number
  x1: number
  /** Middle row of the top staff line. */
  topLineY: number
  /** Middle row of the bottom staff line. */
  bottomLineY: number
}

type StaffLine = {
  /** Middle row of a 1–2 px cluster. */
  y: number
  y0: number
  y1: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function hasInk(page: PageInk): boolean {
  for (let i = 0; i < page.dark.length; i++) {
    if (page.dark[i]) return true
  }
  return false
}

function contentXRange(width: number): { x0: number; x1: number } {
  const inset = width * staffDetect.edgeIgnore
  const x0 = clamp(Math.floor(inset), 0, width)
  const x1 = clamp(Math.ceil(width - inset), x0, width)
  return { x0, x1 }
}

function staffLineRows(page: PageInk, range: XRange): number[] {
  const x0 = clamp(range.x0, 0, page.width)
  const x1 = clamp(range.x1, x0, page.width)
  const contentWidth = x1 - x0
  if (contentWidth <= 0) return []
  const rows: number[] = []
  for (let y = 0; y < page.height; y++) {
    const row = y * page.width
    let dark = 0
    for (let x = x0; x < x1; x++) dark += page.dark[row + x]!
    if (dark / contentWidth >= staffDetect.staffLineMin) rows.push(y)
  }
  return rows
}

function clusterStaffLines(rows: number[]): StaffLine[] {
  const lines: StaffLine[] = []
  let i = 0
  while (i < rows.length) {
    let j = i + 1
    while (j < rows.length && rows[j]! - rows[j - 1]! <= staffDetect.staffLineClusterPx) j++
    const y0 = rows[i]!
    const y1 = rows[j - 1]!
    lines.push({ y: Math.round((y0 + y1) / 2), y0, y1 })
    i = j
  }
  return lines
}

function runFits(lines: readonly StaffLine[], start: number, count: number): boolean {
  if (count < MIN_STAFF_LINES || count > MAX_STAFF_LINES) return false
  let minGap = Number.POSITIVE_INFINITY
  for (let i = 0; i < count - 1; i++) {
    const gap = lines[start + i + 1]!.y - lines[start + i]!.y
    if (gap < MIN_LINE_SPACING) return false
    if (gap < minGap) minGap = gap
  }
  const limit = staffDetect.spacingSlack * minGap
  for (let i = 0; i < count - 1; i++) {
    if (lines[start + i + 1]!.y - lines[start + i]!.y > limit) return false
  }
  return true
}

function xSpanOfLines(
  page: PageInk,
  lines: readonly StaffLine[],
  start: number,
  count: number,
  range: XRange,
): { x0: number; x1: number } {
  const scan0 = clamp(range.x0, 0, page.width)
  const scan1 = clamp(range.x1, scan0, page.width)
  let x0 = scan1
  let x1 = scan0 - 1
  for (let i = 0; i < count; i++) {
    const line = lines[start + i]!
    for (let y = line.y0; y <= line.y1; y++) {
      const row = y * page.width
      for (let x = scan0; x < scan1; x++) {
        if (!page.dark[row + x]) continue
        if (x < x0) x0 = x
        if (x > x1) x1 = x
      }
    }
  }
  if (x1 < scan0) return { x0: scan0, x1: Math.max(scan0, scan1 - 1) }
  return { x0, x1 }
}

/** Each 4–6 line run is one staff. A left connector may merge staves into one system. */
function findStaves(page: PageInk, score: XRange, span: XRange): StaffSpan[] {
  const lines = clusterStaffLines(staffLineRows(page, score))
  const staves: StaffSpan[] = []
  let i = 0
  while (i < lines.length) {
    let count = 0
    const maxCount = Math.min(MAX_STAFF_LINES, lines.length - i)
    for (let n = MIN_STAFF_LINES; n <= maxCount; n++) {
      if (runFits(lines, i, n)) count = n
    }
    if (count >= MIN_STAFF_LINES) {
      const first = lines[i]!
      const last = lines[i + count - 1]!
      const xSpan = xSpanOfLines(page, lines, i, count, span)
      staves.push({
        y0: first.y0,
        y1: last.y1,
        x0: xSpan.x0,
        x1: xSpan.x1,
        topLineY: first.y,
        bottomLineY: last.y,
      })
      i += count
    } else {
      i += 1
    }
  }
  return staves
}

/** Rows strictly between the two staff-line rows. Scan starts left of the content so a brace in the margin counts. */
function leftConnector(
  page: PageInk,
  prevLineY: number,
  nextLineY: number,
  content: XRange,
  scanFrom: number,
): boolean {
  const y0 = prevLineY + 1
  const y1 = nextLineY - 1
  if (y1 < y0) return false
  const contentWidth = content.x1 - content.x0
  if (contentWidth <= 0) return false
  const zoneEnd = content.x0 + staffDetect.connectorZoneFrac * contentWidth
  const xMax = Math.min(page.width - 1, Math.floor(zoneEnd))
  const xMin = clamp(scanFrom, 0, page.width)
  if (xMax < xMin) return false
  const gapRows = y1 - y0 + 1
  let covered = 0
  for (let y = y0; y <= y1; y++) {
    const row = y * page.width
    for (let x = xMin; x <= xMax; x++) {
      if (!page.dark[row + x]) continue
      covered++
      break
    }
  }
  return covered / gapRows >= staffDetect.connectorCoverage
}

/**
 * A barline or brace that reaches both staves. A short mark in the middle of the
 * gap does not. The crop edge must not cut that line.
 */
function verticalLineJoins(page: PageInk, upperLineY: number, lowerLineY: number): boolean {
  const y0 = upperLineY + 1
  const y1 = lowerLineY - 1
  if (y1 - y0 < 3) return false
  const gap = y1 - y0 + 1
  const reach = Math.max(2, Math.floor(gap * 0.08))
  for (let x = 0; x < page.width; x++) {
    let covered = 0
    let first = -1
    let last = -1
    for (let y = y0; y <= y1; y++) {
      if (!page.dark[y * page.width + x]) continue
      covered++
      if (first < 0) first = y
      last = y
    }
    if (covered / gap < 0.6) continue
    if (first <= y0 + reach && last >= y1 - reach) return true
  }
  return false
}

function unionStaffSpan(staves: readonly StaffSpan[], start: number, end: number): StaffSpan {
  const first = staves[start]!
  let y0 = first.y0
  let y1 = first.y1
  let x0 = first.x0
  let x1 = first.x1
  for (let i = start + 1; i < end; i++) {
    const staff = staves[i]!
    if (staff.y0 < y0) y0 = staff.y0
    if (staff.y1 > y1) y1 = staff.y1
    if (staff.x0 < x0) x0 = staff.x0
    if (staff.x1 > x1) x1 = staff.x1
  }
  const last = staves[end - 1]!
  return { y0, y1, x0, x1, topLineY: first.topLineY, bottomLineY: last.bottomLineY }
}

function mergeByLeftConnector(
  page: PageInk,
  staves: readonly StaffSpan[],
  content: XRange,
  scanFrom: number,
): StaffSpan[] {
  if (staves.length === 0) return []
  const systems: StaffSpan[] = []
  let start = 0
  for (let i = 1; i <= staves.length; i++) {
    const prev = staves[i - 1]
    const next = staves[i]
    const join =
      prev != null &&
      next != null &&
      (leftConnector(page, prev.bottomLineY, next.topLineY, content, scanFrom) ||
        verticalLineJoins(page, prev.bottomLineY, next.topLineY))
    if (join) continue
    systems.push(unionStaffSpan(staves, start, i))
    start = i
  }
  return systems
}

function verticalDistance(y: number, span: StaffSpan): number {
  if (y < span.y0) return span.y0 - y
  if (y > span.y1) return y - span.y1
  return 0
}

function horizontalDistance(x: number, span: StaffSpan): number {
  if (x < span.x0) return span.x0 - x
  if (x > span.x1) return x - span.x1
  return 0
}

function assignInk(page: PageInk, staves: readonly StaffSpan[]): Int32Array {
  const owner = new Int32Array(page.dark.length)
  owner.fill(-1)
  if (staves.length === 0) {
    for (let i = 0; i < page.dark.length; i++) {
      if (page.dark[i]) owner[i] = 0
    }
    return owner
  }
  for (let y = 0; y < page.height; y++) {
    const row = y * page.width
    for (let x = 0; x < page.width; x++) {
      if (!page.dark[row + x]) continue
      let best = 0
      let bestV = Number.POSITIVE_INFINITY
      let bestH = Number.POSITIVE_INFINITY
      for (let s = 0; s < staves.length; s++) {
        const span = staves[s]!
        const v = verticalDistance(y, span)
        const h = horizontalDistance(x, span)
        if (v < bestV || (v === bestV && h < bestH)) {
          best = s
          bestV = v
          bestH = h
        }
      }
      owner[row + x] = best
    }
  }
  return owner
}

function regionFromInk(
  width: number,
  height: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): RegionNorm {
  let x = minX / width - staffDetect.padFrac
  let y = minY / height - staffDetect.padFrac
  let w = (maxX - minX) / width + staffDetect.padFrac * 2
  let h = (maxY - minY) / height + staffDetect.padFrac * 2

  if (x < 0) {
    w += x
    x = 0
  }
  if (y < 0) {
    h += y
    y = 0
  }

  const minW = Math.min(MIN_REGION_NORM, 1)
  const minH = Math.min(MIN_REGION_NORM, 1)
  if (w < minW) {
    w = minW
    x = clamp(x, 0, 1 - w)
  }
  if (h < minH) {
    h = minH
    y = clamp(y, 0, 1 - h)
  }

  // Compare sums instead of trusting `1 - x` the other way: 1 - 0.9 is 0.0999… in IEEE float.
  if (x + w > 1) w = Math.max(0, 1 - x)
  if (y + h > 1) h = Math.max(0, 1 - y)
  return { x, y, w, h }
}

function regionsFromOwner(page: PageInk, owner: Int32Array, systemCount: number): RegionNorm[] {
  const minX = new Int32Array(systemCount).fill(page.width)
  const maxX = new Int32Array(systemCount).fill(-1)
  const minY = new Int32Array(systemCount).fill(page.height)
  const maxY = new Int32Array(systemCount).fill(-1)
  for (let y = 0; y < page.height; y++) {
    const row = y * page.width
    for (let x = 0; x < page.width; x++) {
      const system = owner[row + x]!
      if (system < 0) continue
      if (x < minX[system]!) minX[system] = x
      if (x > maxX[system]!) maxX[system] = x
      if (y < minY[system]!) minY[system] = y
      if (y > maxY[system]!) maxY[system] = y
    }
  }
  const regions: RegionNorm[] = []
  for (let s = 0; s < systemCount; s++) {
    if (maxX[s]! < 0) continue
    regions.push(regionFromInk(page.width, page.height, minX[s]!, maxX[s]!, minY[s]!, maxY[s]!))
  }
  return regions
}

/** Ink span, not paper height. A one-row title stays under gutterInkMax; a one-staff column still clears gutterSideInkMin. */
function inkContentHeight(page: PageInk): number {
  let y0 = page.height
  let y1 = -1
  for (let i = 0; i < page.dark.length; i++) {
    if (!page.dark[i]) continue
    const y = Math.floor(i / page.width)
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (y1 < y0) return 0
  return y1 - y0 + 1
}

function columnInkFractions(page: PageInk, contentHeight: number): Float64Array {
  const fractions = new Float64Array(page.width)
  for (let y = 0; y < page.height; y++) {
    const row = y * page.width
    for (let x = 0; x < page.width; x++) fractions[x] += page.dark[row + x]!
  }
  for (let x = 0; x < page.width; x++) fractions[x] /= contentHeight
  return fractions
}

function sideHasColumn(fractions: Float64Array, x0: number, x1: number): boolean {
  for (let x = x0; x < x1; x++) {
    if (fractions[x]! > gutterSideInkMin) return true
  }
  return false
}

/** Widest low-ink run whose center sits in the middle half of the content width. Null means one column. */
function findGutter(page: PageInk): XRange | null {
  const content = contentXRange(page.width)
  const contentWidth = content.x1 - content.x0
  if (contentWidth <= 0) return null
  const contentHeight = inkContentHeight(page)
  if (contentHeight <= 0) return null

  const fractions = columnInkFractions(page, contentHeight)
  const minWidth = gutterMinWidthFrac * page.width
  const mid0 = content.x0 + contentWidth * 0.25
  const mid1 = content.x0 + contentWidth * 0.75

  let best: XRange | null = null
  let bestWidth = 0
  let runStart = -1
  for (let x = 0; x <= page.width; x++) {
    const low = x < page.width && fractions[x]! < gutterInkMax
    if (low) {
      if (runStart < 0) runStart = x
      continue
    }
    if (runStart < 0) continue
    const x0 = runStart
    const x1 = x
    runStart = -1
    const width = x1 - x0
    if (width < minWidth) continue
    const center = (x0 + x1) / 2
    if (center < mid0 || center > mid1) continue
    if (!sideHasColumn(fractions, 0, x0) || !sideHasColumn(fractions, x1, page.width)) continue
    if (width <= bestWidth) continue
    best = { x0, x1 }
    bestWidth = width
  }
  return best
}

function byTopThenLeft(a: RegionNorm, b: RegionNorm): number {
  return a.y - b.y || a.x - b.x
}

export function detectStaffSystems(page: PageInk): RegionNorm[] {
  if (page.width < 8 || page.height < 8) return []
  if (!hasInk(page)) return []

  const gutter = findGutter(page)
  if (!gutter) {
    const content = contentXRange(page.width)
    const full: XRange = { x0: 0, x1: page.width }
    const systems = mergeByLeftConnector(page, findStaves(page, content, full), content, 0)
    const owner = assignInk(page, systems)
    const regions = regionsFromOwner(page, owner, Math.max(systems.length, 1))
    regions.sort(byTopThenLeft)
    return regions
  }

  const left: XRange = { x0: 0, x1: gutter.x0 }
  const right: XRange = { x0: gutter.x1, x1: page.width }
  const leftSystems = mergeByLeftConnector(page, findStaves(page, left, left), left, 0)
  const rightSystems = mergeByLeftConnector(page, findStaves(page, right, right), right, gutter.x0)
  const systems = [...leftSystems, ...rightSystems]
  const owner = assignInk(page, systems)
  const regions = regionsFromOwner(page, owner, Math.max(systems.length, 1))
  if (systems.length === 0) return regions

  const leftRegions = regions.slice(0, leftSystems.length)
  const rightRegions = regions.slice(leftSystems.length)
  leftRegions.sort(byTopThenLeft)
  rightRegions.sort(byTopThenLeft)
  return [...leftRegions, ...rightRegions]
}
