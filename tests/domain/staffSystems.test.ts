import { describe, expect, it } from 'vitest'
import type { RegionNorm } from '../../src/domain/schemas.ts'
import { detectStaffSystems, pageInkFromRgba, type PageInk } from '../../src/domain/staffSystems.ts'

function emptyPage(width: number, height: number): PageInk {
  return { width, height, dark: new Uint8Array(width * height) }
}

function inkAt(page: PageInk, x: number, y: number, value: 0 | 1) {
  if (x < 0 || y < 0 || x >= page.width || y >= page.height) return
  page.dark[y * page.width + x] = value
}

function drawStaff(page: PageInk, x: number, y: number, width: number, gap: number) {
  for (let line = 0; line < 5; line++) {
    const row = y + line * gap
    for (let i = 0; i < width; i++) inkAt(page, x + i, row, 1)
  }
}

function expectInkCovered(page: PageInk, regions: RegionNorm[]) {
  for (let y = 0; y < page.height; y++) {
    for (let x = 0; x < page.width; x++) {
      if (!page.dark[y * page.width + x]) continue
      const nx = x / page.width
      const ny = y / page.height
      const hit = regions.some((r) => nx >= r.x && nx <= r.x + r.w && ny >= r.y && ny <= r.y + r.h)
      expect(hit, `ink at ${x},${y} outside crops`).toBe(true)
    }
  }
}

describe('pageInkFromRgba', () => {
  it('marks dark pixels and treats white and transparent as paper', () => {
    const rgba = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 0,
      180, 180, 180, 255,
    ])
    const ink = pageInkFromRgba(4, 1, rgba)
    expect(ink.width).toBe(4)
    expect(ink.height).toBe(1)
    expect(Array.from(ink.dark)).toEqual([1, 0, 0, 1])
  })

  it('does not treat a gray photo background as ink', () => {
    const width = 64
    const height = 64
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      const x = i % width
      const paper = x < 32 ? 120 : 170
      const o = i * 4
      rgba[o] = paper
      rgba[o + 1] = paper
      rgba[o + 2] = paper
      rgba[o + 3] = 255
    }
    rgba[0] = 20
    rgba[1] = 20
    rgba[2] = 20
    const ink = pageInkFromRgba(width, height, rgba)
    let dark = 0
    for (const value of ink.dark) dark += value
    expect(dark).toBe(1)
    expect(ink.dark[0]).toBe(1)
  })
})

describe('detectStaffSystems', () => {
  it('returns two systems top to bottom and keeps the title inside the first', () => {
    const page = emptyPage(200, 400)
    for (let x = 40; x < 90; x++) inkAt(page, x, 12, 1)
    drawStaff(page, 20, 40, 160, 4)
    drawStaff(page, 20, 200, 160, 4)
    const regions = detectStaffSystems(page)
    expect(regions).toHaveLength(2)
    expect(regions[0]!.y).toBeLessThan(regions[1]!.y)
    expect(regions[0]!.y).toBeLessThanOrEqual(12 / 400)
    expect(regions[1]!.y).toBeGreaterThan(0.35)
    expectInkCovered(page, regions)
  })

  it('merges staves when a left connector crosses the gap', () => {
    const page = emptyPage(200, 300)
    drawStaff(page, 30, 40, 150, 4) // 40..56
    drawStaff(page, 30, 120, 150, 4) // 120..136
    for (let y = 56; y <= 120; y++) inkAt(page, 24, y, 1)
    const regions = detectStaffSystems(page)
    expect(regions).toHaveLength(1)
    expectInkCovered(page, regions)
  })

  it('keeps single-staff systems apart when nothing on the left joins them', () => {
    const page = emptyPage(200, 300)
    drawStaff(page, 30, 40, 150, 4)
    drawStaff(page, 30, 120, 150, 4)
    const regions = detectStaffSystems(page)
    expect(regions).toHaveLength(2)
    expectInkCovered(page, regions)
  })

  it('does not merge on a mark in the middle of the gap', () => {
    const page = emptyPage(200, 300)
    drawStaff(page, 30, 40, 150, 4)
    drawStaff(page, 30, 120, 150, 4)
    for (let y = 70; y <= 100; y++) inkAt(page, 100, y, 1)
    const regions = detectStaffSystems(page)
    expect(regions).toHaveLength(2)
    expectInkCovered(page, regions)
  })

  it('merges staves when a barline crosses the gap away from the left', () => {
    const page = emptyPage(200, 300)
    drawStaff(page, 30, 40, 150, 4)
    drawStaff(page, 30, 120, 150, 4)
    for (let y = 56; y <= 120; y++) inkAt(page, 100, y, 1)
    const regions = detectStaffSystems(page)
    expect(regions).toHaveLength(1)
    expectInkCovered(page, regions)
  })

  it('returns one ink box for a title-only page, and nothing for blank paper', () => {
    const titled = emptyPage(200, 400)
    for (let x = 40; x < 90; x++) inkAt(titled, x, 12, 1)
    const regions = detectStaffSystems(titled)
    expect(regions).toHaveLength(1)
    expectInkCovered(titled, regions)
    expect(detectStaffSystems(emptyPage(200, 400))).toEqual([])
  })

  it('keeps a braced system as one crop when lyric ink sits between staves', () => {
    const page = emptyPage(200, 300)
    drawStaff(page, 30, 40, 150, 4)
    drawStaff(page, 30, 90, 150, 4)
    for (let y = 56; y <= 90; y++) inkAt(page, 22, y, 1)
    for (let x = 40; x < 70; x++) inkAt(page, x, 70, 1)
    const regions = detectStaffSystems(page)
    expect(regions).toHaveLength(1)
    expectInkCovered(page, regions)
  })

  it('keeps lyric ink and a distant footer inside the only crop', () => {
    const page = emptyPage(200, 400)
    drawStaff(page, 20, 40, 160, 4)
    for (let x = 30; x < 80; x++) inkAt(page, x, 68, 1)
    for (let x = 20; x < 160; x++) inkAt(page, x, 200, 1)
    const regions = detectStaffSystems(page)
    expect(regions).toHaveLength(1)
    expectInkCovered(page, regions)
  })

  it('reads a two-column page left column then right column', () => {
    const page = emptyPage(300, 400)
    drawStaff(page, 10, 40, 100, 4)
    drawStaff(page, 10, 200, 100, 4)
    drawStaff(page, 180, 40, 100, 4)
    inkAt(page, 140, 8, 1) // title mark in the gutter, above the staves
    const regions = detectStaffSystems(page)
    expect(regions).toHaveLength(3)
    expect(regions[0]!.x).toBeLessThan(0.4)
    expect(regions[1]!.x).toBeLessThan(0.4)
    expect(regions[1]!.y).toBeGreaterThan(regions[0]!.y)
    expect(regions[2]!.x).toBeGreaterThan(0.5)
    expectInkCovered(page, regions)
  })
})
