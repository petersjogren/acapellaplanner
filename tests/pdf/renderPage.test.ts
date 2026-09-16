import { describe, expect, it } from 'vitest'
import { pdfEngineLoadError } from '../../src/pdf/renderPage.ts'

describe('pdfEngineLoadError', () => {
  it('turns a failed pdfjs chunk fetch into a refresh hint', () => {
    const err = new TypeError(
      'Failed to fetch dynamically imported module: https://petersjogren.github.io/acapellaplanner/assets/pdfjsRender-BB-FQkRp.js',
    )
    const mapped = pdfEngineLoadError(err)
    expect(mapped).toBeInstanceOf(Error)
    expect((mapped as Error).message).toMatch(/refresh the page/i)
  })

  it('leaves unrelated errors unchanged', () => {
    const err = new Error('PDF page 9 is out of range')
    expect(pdfEngineLoadError(err)).toBe(err)
  })
})
