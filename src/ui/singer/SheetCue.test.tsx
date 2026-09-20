import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Phrase } from '../../domain/schemas.ts'
import { SheetCue, SHEET_CUE_SLIDE_HEIGHT_PX } from './SheetCue.tsx'

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  // jsdom has no real layout; ResizeObserver isn't implemented either.
  // SheetCue degrades gracefully (viewport width 0) but stub it so the
  // effect wiring itself doesn't throw.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})

const PAGE = 'data:image/png;base64,aaaa'
const PAGE_2 = 'data:image/png;base64,bbbb'

function phrase(overrides: Partial<Phrase> = {}): Phrase {
  return {
    id: 'p1',
    name: 'when I fall',
    startMs: 0,
    endMs: 1000,
    sheetRefs: [],
    partPlan: [],
    loopDefault: { mode: 'phrase-loop', gapMs: 400 },
    postRollMs: 0,
    ...overrides,
  }
}

function trackWidthPx(): number {
  const track = screen.getByLabelText('Sheet crop').querySelector('[data-sheet-cue-track]') as HTMLElement
  return Number(track.style.width.replace('px', ''))
}

function trackTranslateXPx(): number {
  const track = screen.getByLabelText('Sheet crop').querySelector('[data-sheet-cue-track]') as HTMLElement
  const match = /translateX\((-?[\d.]+)px\)/.exec(track.style.transform)
  return match ? Number(match[1]) : NaN
}

function slideWidthPx(index: number): number {
  const slide = screen.getByLabelText('Sheet crop').querySelector(`[data-sheet-slide="${index}"]`) as HTMLElement
  return Number(slide.style.width.replace('px', ''))
}

describe('SheetCue', () => {
  it('renders nothing without sheetRefs', () => {
    const { container } = render(<SheetCue phrase={phrase()} pageImageUrls={[PAGE]} />)
    expect(container.querySelector('img, canvas')).toBeNull()
    expect(screen.queryByLabelText('Sheet crop')).toBeNull()
  })

  it('renders nothing without a page image even when a crop exists', () => {
    const { container } = render(
      <SheetCue
        phrase={phrase({
          sheetRefs: [{ id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 1, h: 1 } }],
        })}
      />,
    )
    expect(container.querySelector('img, canvas')).toBeNull()
  })

  it('shows an img clipped to the crop', () => {
    render(
      <SheetCue
        phrase={phrase({
          sheetRefs: [
            {
              id: 'ref-1',
              sheetDocId: 'doc-1',
              pageIndex: 0,
              regionNorm: { x: 0.1, y: 0.2, w: 0.5, h: 0.25 },
            },
          ],
        })}
        pageImageUrls={[PAGE]}
      />,
    )

    const figure = screen.getByLabelText('Sheet crop')
    const img = figure.querySelector('img')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('src')).toBe(PAGE)
    // Crop via layout, not transform — iPad Safari double-paints a
    // transformed <img> inside a translating ancestor.
    // region {x:0.1,y:0.2,w:0.5,h:0.25} → page is 200% × 400% of the box,
    // shifted so (0.1, 0.2) sits at the box origin.
    expect(img?.style.width).toBe('200%')
    expect(img?.style.height).toBe('400%')
    expect(img?.style.left).toBe('-20%')
    expect(img?.style.top).toBe('-80%')
    expect(img?.style.maxWidth).toBe('none')
    expect(img?.style.maxHeight).toBe('none')
    expect(img?.style.transform).toBe('')
  })

  it('does not transform filmstrip imgs — only the track translates', () => {
    render(
      <SheetCue
        phrase={phrase({
          startMs: 0,
          endMs: 4000,
          sheetRefs: [
            { id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 0.5, h: 0.5 } },
            { id: 'ref-2', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
          ],
        })}
        pageImageUrls={[PAGE, PAGE]}
        elapsedMs={1000}
      />,
    )
    const figure = screen.getByLabelText('Sheet crop')
    const imgs = figure.querySelectorAll('img')
    expect(imgs).toHaveLength(2)
    imgs.forEach((img) => {
      expect(img.style.transform).toBe('')
    })
    const track = figure.querySelector('[data-sheet-cue-track]') as HTMLElement
    expect(track.style.transform).toMatch(/translateX\(-/)
    expect(track.style.transition).toBe('')
    expect(track.className).not.toMatch(/sheet-cue-pan/)
  })

  it('sets an aspect-ratio style from the region before the image loads (single crop)', () => {
    render(
      <SheetCue
        phrase={phrase({
          sheetRefs: [
            {
              id: 'ref-1',
              sheetDocId: 'doc-1',
              pageIndex: 0,
              regionNorm: { x: 0, y: 0, w: 0.5, h: 0.25 },
            },
          ],
        })}
        pageImageUrls={[PAGE]}
      />,
    )
    const figure = screen.getByLabelText('Sheet crop')
    // w/h = 2 pre-load fallback (natural page size not known yet).
    expect(figure.style.aspectRatio).toBe('2 / 1')
  })

  it('renders every crop as its own slide, in order, each with its own image', () => {
    render(
      <SheetCue
        phrase={phrase({
          startMs: 0,
          endMs: 4000,
          sheetRefs: [
            { id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 0.5, h: 0.5 } },
            { id: 'ref-2', sheetDocId: 'doc-2', pageIndex: 0, regionNorm: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
          ],
        })}
        pageImageUrls={[PAGE, PAGE_2]}
        elapsedMs={0}
      />,
    )
    const slides = screen.getByLabelText('Sheet crop').querySelectorAll('[data-sheet-slide]')
    expect(slides).toHaveLength(2)
    expect(slides[0]?.querySelector('img')?.getAttribute('src')).toBe(PAGE)
    expect(slides[1]?.querySelector('img')?.getAttribute('src')).toBe(PAGE_2)
  })

  it('never stretches a crop: each slide keeps its own aspect ratio, not an equal share of the track', () => {
    // 4x4 (square) crop next to a 16x4 (4x wider) crop — the bug report's
    // exact numbers. Pre-load fallback aspect comes straight from the
    // region's own w/h, so a 1:1 region and a 4:1 region must NOT get the
    // same slide width just because there are two slides.
    render(
      <SheetCue
        phrase={phrase({
          startMs: 0,
          endMs: 4000,
          sheetRefs: [
            // Square region -> aspect 1.
            { id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 0.25, h: 0.25 } },
            // 4x wider than tall -> aspect 4.
            { id: 'ref-2', sheetDocId: 'doc-2', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 1, h: 0.25 } },
          ],
        })}
        pageImageUrls={[PAGE, PAGE_2]}
        elapsedMs={0}
      />,
    )
    const squareWidth = slideWidthPx(0)
    const wideWidth = slideWidthPx(1)
    // Fixed slide height, so width IS the aspect ratio in pixels.
    expect(squareWidth).toBeCloseTo(SHEET_CUE_SLIDE_HEIGHT_PX * 1, 5)
    expect(wideWidth).toBeCloseTo(SHEET_CUE_SLIDE_HEIGHT_PX * 4, 5)
    expect(wideWidth).toBeCloseTo(squareWidth * 4, 5)
    // The track is exactly the sum of the two slides' own widths, not
    // 2 x an equal share.
    expect(trackWidthPx()).toBeCloseTo(squareWidth + wideWidth, 5)
  })

  it('places slides side by side without gaps (track width is the exact sum of slide widths)', () => {
    render(
      <SheetCue
        phrase={phrase({
          startMs: 0,
          endMs: 3000,
          sheetRefs: [
            { id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 0.5, h: 0.5 } },
            { id: 'ref-2', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 0.2, h: 0.4 } },
            { id: 'ref-3', sheetDocId: 'doc-2', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 1, h: 0.1 } },
          ],
        })}
        pageImageUrls={[PAGE, PAGE, PAGE_2]}
        elapsedMs={0}
      />,
    )
    const sum = slideWidthPx(0) + slideWidthPx(1) + slideWidthPx(2)
    expect(trackWidthPx()).toBeCloseTo(sum, 5)
  })

  it('scrolls hard left at elapsed 0: every part of the first crop is visible', () => {
    const sheetRefs = [
      { id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      { id: 'ref-2', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
    ]
    render(
      <SheetCue
        phrase={phrase({ startMs: 0, endMs: 4000, sheetRefs })}
        pageImageUrls={[PAGE, PAGE]}
        elapsedMs={0}
      />,
    )
    // translateX 0 means the track's own left edge sits exactly at the
    // viewport's left edge — nothing before the first crop is cut off, and
    // no part of the first crop is scrolled out of view either.
    expect(trackTranslateXPx()).toBe(0)
  })

  it('scrolls hard right at elapsed = duration: the last crop is flush against the right edge, no empty space', () => {
    const sheetRefs = [
      { id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 0.25, h: 0.25 } },
      { id: 'ref-2', sheetDocId: 'doc-2', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 1, h: 0.25 } },
    ]
    render(
      <SheetCue
        phrase={phrase({ startMs: 0, endMs: 4000, sheetRefs })}
        pageImageUrls={[PAGE, PAGE_2]}
        elapsedMs={4000}
      />,
    )
    const totalWidth = slideWidthPx(0) + slideWidthPx(1)
    // jsdom reports 0 for clientWidth (no real layout), so the "viewport"
    // is 0 px wide here — translateX must shift the track exactly its own
    // full width to the left so the right edge lands exactly on 0, never
    // short (leftover on the right) and never past it (leftover on the
    // left instead).
    expect(trackTranslateXPx()).toBeCloseTo(-totalWidth, 5)
  })

  it('never scrolls past either end when the whole strip already fits the viewport', () => {
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(5000)
    try {
      const sheetRefs = [
        { id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 0.5, h: 0.5 } },
        { id: 'ref-2', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
      ]
      const { rerender } = render(
        <SheetCue
          phrase={phrase({ startMs: 0, endMs: 4000, sheetRefs })}
          pageImageUrls={[PAGE, PAGE]}
          elapsedMs={0}
        />,
      )
      expect(trackTranslateXPx()).toBe(0)

      rerender(
        <SheetCue
          phrase={phrase({ startMs: 0, endMs: 4000, sheetRefs })}
          pageImageUrls={[PAGE, PAGE]}
          elapsedMs={4000}
        />,
      )
      // A viewport wider than the whole strip means there is no scroll
      // range at all — must stay pinned left, never create trailing empty
      // space by "finishing" a scroll that was never possible.
      expect(trackTranslateXPx()).toBe(0)
    } finally {
      clientWidthSpy.mockRestore()
    }
  })

  it('keeps the last crop on screen at elapsed = duration even when the figure only mounts on a later render', () => {
    // Regression: SingPage resolves crop image URLs asynchronously, so
    // SheetCue's first render(s) return null (see "renders nothing without
    // a page image") and the real <figure> only mounts once URLs arrive.
    // A plain useRef + empty-deps useEffect fires exactly once, at the very
    // first commit — before that <figure> existed — and never re-measures
    // once it actually mounts, so the viewport width stayed stuck at 0.
    // That made maxScrollPx equal the strip's *entire* width, scrolling
    // everything (including the last crop) off past the left edge at
    // elapsed = duration instead of stopping with its right edge in view.
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(300)
    try {
      const sheetRefs = [
        { id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 0.5, h: 0.5 } },
        { id: 'ref-2', sheetDocId: 'doc-2', pageIndex: 0, regionNorm: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
      ]
      // First render: no image URLs resolved yet -> renders null, no <figure>.
      const { rerender } = render(
        <SheetCue
          phrase={phrase({ startMs: 0, endMs: 4000, sheetRefs })}
          pageImageUrls={[undefined, undefined]}
          elapsedMs={4000}
        />,
      )
      expect(screen.queryByLabelText('Sheet crop')).toBeNull()

      // Second render: URLs resolved -> the <figure> mounts for the first
      // time on THIS render, not the component's first render.
      rerender(
        <SheetCue
          phrase={phrase({ startMs: 0, endMs: 4000, sheetRefs })}
          pageImageUrls={[PAGE, PAGE_2]}
          elapsedMs={4000}
        />,
      )

      const totalWidth = slideWidthPx(0) + slideWidthPx(1)
      const viewportWidth = 300
      // Right edge of the strip must land exactly at the viewport's right
      // edge: translateX = -(total - viewport), never -total (which would
      // push the whole strip, last crop included, off-screen to the left).
      expect(trackTranslateXPx()).toBeCloseTo(-(totalWidth - viewportWidth), 5)
    } finally {
      clientWidthSpy.mockRestore()
    }
  })

  it('scrolls the track horizontally and continuously as elapsed time advances', () => {
    const sheetRefs = [
      { id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 0.5, h: 0.5 } },
      { id: 'ref-2', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } },
    ]
    const { rerender } = render(
      <SheetCue
        phrase={phrase({ startMs: 0, endMs: 4000, sheetRefs })}
        pageImageUrls={[PAGE, PAGE]}
        elapsedMs={0}
      />,
    )
    const atStart = trackTranslateXPx()

    rerender(
      <SheetCue
        phrase={phrase({ startMs: 0, endMs: 4000, sheetRefs })}
        pageImageUrls={[PAGE, PAGE]}
        elapsedMs={1000}
      />,
    )
    const atQuarter = trackTranslateXPx()

    rerender(
      <SheetCue
        phrase={phrase({ startMs: 0, endMs: 4000, sheetRefs })}
        pageImageUrls={[PAGE, PAGE]}
        elapsedMs={2000}
      />,
    )
    const atHalf = trackTranslateXPx()

    // Continuous, one-directional travel — no jump back and no repeated value.
    expect(atQuarter).toBeLessThan(atStart)
    expect(atHalf).toBeLessThan(atQuarter)
  })

  it('keeps scrolling smoothly across a page/doc boundary between differently-sized crops', () => {
    const sheetRefs = [
      { id: 'ref-1', sheetDocId: 'doc-1', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 0.25, h: 0.25 } },
      { id: 'ref-2', sheetDocId: 'doc-2', pageIndex: 0, regionNorm: { x: 0, y: 0, w: 1, h: 0.25 } },
    ]
    const { rerender } = render(
      <SheetCue
        phrase={phrase({ startMs: 0, endMs: 4000, sheetRefs })}
        pageImageUrls={[PAGE, PAGE_2]}
        elapsedMs={1000}
      />,
    )
    const before = trackTranslateXPx()

    rerender(
      <SheetCue
        phrase={phrase({ startMs: 0, endMs: 4000, sheetRefs })}
        pageImageUrls={[PAGE, PAGE_2]}
        elapsedMs={3000}
      />,
    )
    const after = trackTranslateXPx()

    // A different source image AND a different aspect ratio per crop must
    // not stop the scroll — it is still one continuous horizontal
    // translateX in real pixels.
    expect(after).toBeLessThan(before)
  })
})
