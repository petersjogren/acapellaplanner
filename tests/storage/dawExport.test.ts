import { describe, expect, it } from 'vitest'
import { laneLetter, lanePath, safeSegment, stemPath } from '../../src/storage/dawExport.ts'

describe('safeSegment', () => {
  it('keeps letters, digits, dash and underscore', () => {
    expect(safeSegment('Bass 1')).toBe('Bass-1')
    expect(safeSegment('Sop/Alto')).toBe('Sop-Alto')
    expect(safeSegment('  Tenor  ')).toBe('Tenor')
    expect(safeSegment('Ångström')).toBe('Angstrom')
  })

  it('never returns an empty string', () => {
    expect(safeSegment('///')).toBe('part')
    expect(safeSegment('')).toBe('part')
  })
})

describe('laneLetter', () => {
  it('is A, B, C ... then falls back past Z', () => {
    expect(laneLetter(0)).toBe('A')
    expect(laneLetter(25)).toBe('Z')
    expect(laneLetter(26)).toBe('L27')
  })
})

describe('lanePath', () => {
  it('is <Part>/<Part>_<letter>.wav', () => {
    expect(lanePath('Bass', 0)).toBe('Bass/Bass_A.wav')
    expect(lanePath('Sop 1/2', 1)).toBe('Sop-1-2/Sop-1-2_B.wav')
  })
})

describe('stemPath', () => {
  it('is <Part>/<label>_p<phrase>_t<take>.wav', () => {
    expect(
      stemPath({ partName: 'Bass', shortLabel: 'B', phraseIndex: 1, takeIndex: 2 }),
    ).toBe('Bass/B_p1_t2.wav')
  })

  it('sanitises both the folder and the file', () => {
    expect(
      stemPath({ partName: 'Sop 1/2', shortLabel: 'S/1', phraseIndex: 10, takeIndex: 3 }),
    ).toBe('Sop-1-2/S-1_p10_t3.wav')
  })
})
