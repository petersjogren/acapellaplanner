import { describe, expect, it } from 'vitest'
import {
  addDraftRect,
  clearDraftPage,
  draftRectCount,
  draftRectsBeforePage,
  draftRefs,
  removeDraftRect,
  resizeDraftRect,
  type CropDraft,
} from '../../src/domain/cropDraft.ts'

function R(y: number) {
  return { x: 0.1, y, w: 0.8, h: 0.1 }
}

describe('clearDraftPage', () => {
  it('empties one page and leaves the others', () => {
    const draft: CropDraft = { docId: 'doc', byPage: [[R(0.1), R(0.3)], [R(0.2)]] }
    expect(clearDraftPage(draft, 0)).toEqual({ docId: 'doc', byPage: [[], [R(0.2)]] })
  })

  it('grows the page array when the page has no entry yet', () => {
    const draft: CropDraft = { docId: 'doc', byPage: [] }
    expect(clearDraftPage(draft, 2).byPage).toEqual([[], [], []])
  })

  it('does not mutate the input', () => {
    const draft: CropDraft = { docId: 'doc', byPage: [[R(0.1)]] }
    clearDraftPage(draft, 0)
    expect(draft.byPage[0]).toHaveLength(1)
  })
})

describe('addDraftRect', () => {
  it('appends to the end of that page', () => {
    const draft: CropDraft = { docId: 'doc', byPage: [[R(0.1)]] }
    expect(addDraftRect(draft, 0, R(0.5)).byPage[0]).toEqual([R(0.1), R(0.5)])
  })

  it('creates the page when the draft has never seen it', () => {
    const draft: CropDraft = { docId: 'doc', byPage: [] }
    expect(addDraftRect(draft, 1, R(0.5)).byPage).toEqual([[], [R(0.5)]])
  })

  it('does not mutate the input', () => {
    const draft: CropDraft = { docId: 'doc', byPage: [[R(0.1)]] }
    addDraftRect(draft, 0, R(0.5))
    expect(draft.byPage[0]).toHaveLength(1)
  })
})

describe('removeDraftRect', () => {
  it('drops one rect and keeps the order of the rest', () => {
    const draft: CropDraft = { docId: 'doc', byPage: [[R(0.1), R(0.2), R(0.3)]] }
    expect(removeDraftRect(draft, 0, 1).byPage[0]).toEqual([R(0.1), R(0.3)])
  })

  it('ignores an out-of-range index or page', () => {
    const draft: CropDraft = { docId: 'doc', byPage: [[R(0.1)]] }
    expect(removeDraftRect(draft, 0, 7)).toEqual(draft)
    expect(removeDraftRect(draft, 4, 0)).toEqual(draft)
  })
})

describe('resizeDraftRect', () => {
  it('replaces one rect in place', () => {
    const draft: CropDraft = { docId: 'doc', byPage: [[R(0.1), R(0.2)]] }
    expect(resizeDraftRect(draft, 0, 1, R(0.9)).byPage[0]).toEqual([R(0.1), R(0.9)])
  })

  it('ignores an out-of-range index or page', () => {
    const draft: CropDraft = { docId: 'doc', byPage: [[R(0.1)]] }
    expect(resizeDraftRect(draft, 0, 3, R(0.9))).toEqual(draft)
    expect(resizeDraftRect(draft, 2, 0, R(0.9))).toEqual(draft)
  })
})

describe('draftRectCount', () => {
  it('sums every page', () => {
    expect(draftRectCount({ docId: 'doc', byPage: [[R(0.1), R(0.2)], [], [R(0.3)]] })).toBe(3)
  })

  it('counts a missing draft as zero', () => {
    expect(draftRectCount(null)).toBe(0)
  })
})

describe('draftRectsBeforePage', () => {
  it('counts every rect on earlier pages', () => {
    const draft: CropDraft = { docId: 'doc', byPage: [[R(0.1), R(0.2)], [R(0.3)], [R(0.4)]] }
    expect(draftRectsBeforePage(draft, 0)).toBe(0)
    expect(draftRectsBeforePage(draft, 1)).toBe(2)
    expect(draftRectsBeforePage(draft, 2)).toBe(3)
  })

  it('handles a missing draft and a page past the end', () => {
    expect(draftRectsBeforePage(null, 3)).toBe(0)
    expect(draftRectsBeforePage({ docId: 'doc', byPage: [[R(0.1)]] }, 9)).toBe(1)
  })

  it('agrees with the film position draftRefs actually commits', () => {
    const draft: CropDraft = { docId: 'doc', byPage: [[R(0.1), R(0.2)], [R(0.3)]] }
    const refs = draftRefs(draft)
    // Page 1's first rect is refs[2] — badge number 3.
    expect(refs[draftRectsBeforePage(draft, 1)]?.regionNorm?.y).toBe(0.3)
  })
})

describe('draftRefs', () => {
  it('flattens page-major, in page order, tagging the doc and page', () => {
    const refs = draftRefs({ docId: 'doc', byPage: [[R(0.1)], [R(0.2), R(0.3)]] })
    expect(refs.map((ref) => [ref.pageIndex, ref.regionNorm?.y])).toEqual([
      [0, 0.1],
      [1, 0.2],
      [1, 0.3],
    ])
    expect(new Set(refs.map((ref) => ref.id)).size).toBe(3)
    expect(refs.every((ref) => ref.sheetDocId === 'doc')).toBe(true)
  })

  it('skips empty pages without shifting the page index', () => {
    const refs = draftRefs({ docId: 'doc', byPage: [[], [], [R(0.4)]] })
    expect(refs).toHaveLength(1)
    expect(refs[0]!.pageIndex).toBe(2)
  })
})
