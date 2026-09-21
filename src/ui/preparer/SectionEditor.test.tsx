import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SectionEditor } from './SectionEditor.tsx'
import type { Phrase, Section } from '../../domain/schemas.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const p1: Phrase = {
  id: 'p1',
  name: 'Phrase 1',
  startMs: 0,
  endMs: 2000,
  partPlan: [],
  loopDefault: { mode: 'phrase-loop', gapMs: 400 },
  postRollMs: 0,
}

const p2: Phrase = {
  ...p1,
  id: 'p2',
  name: 'Phrase 2',
  startMs: 2000,
  endMs: 4000,
}

const verse: Section = {
  id: 's1',
  name: 'Verse',
  timeMode: 'ghost-follow',
  fromPhraseId: 'p1',
  toPhraseId: 'p2',
  clickEnabled: false,
}

function renderEditor(
  sections: Section[] = [],
  phrases: Phrase[] = [p1, p2],
  handlers: Partial<ComponentProps<typeof SectionEditor>> = {},
) {
  const onAddSection = handlers.onAddSection ?? vi.fn()
  const onRemoveSection = handlers.onRemoveSection ?? vi.fn()
  render(
    <SectionEditor
      sections={sections}
      phrases={phrases}
      onAddSection={onAddSection}
      onRemoveSection={onRemoveSection}
    />,
  )
  return { onAddSection, onRemoveSection }
}

describe('SectionEditor', () => {
  it('adds a fixed-tempo section spanning the chosen phrases', () => {
    const { onAddSection } = renderEditor()

    expect(screen.getByRole('heading', { name: 'Sections' })).toBeTruthy()
    expect(screen.getByText(/these phrases, sung this way/i)).toBeTruthy()
    expect(screen.queryByText(/metronome/i)).toBeNull()
    expect(screen.getByRole('option', { name: 'In time' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Follow the ghost' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Section name'), { target: { value: 'Tag' } })
    fireEvent.change(screen.getByLabelText('Time feel'), { target: { value: 'fixed-tempo' } })
    fireEvent.change(screen.getByLabelText('BPM'), { target: { value: '120' } })
    fireEvent.click(screen.getByLabelText('Click'))
    fireEvent.change(screen.getByLabelText('From phrase'), { target: { value: 'p2' } })
    fireEvent.change(screen.getByLabelText('To phrase'), { target: { value: 'p2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))

    expect(onAddSection).toHaveBeenCalledTimes(1)
    expect(onAddSection).toHaveBeenCalledWith({
      name: 'Tag',
      timeMode: 'fixed-tempo',
      fixedBpm: 120,
      fromPhraseId: 'p2',
      toPhraseId: 'p2',
      clickEnabled: true,
    })
  })

  it('does not add a section without a name', () => {
    const { onAddSection } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
    expect(onAddSection).not.toHaveBeenCalled()
  })

  it('lists existing sections by phrase span', () => {
    renderEditor([verse])
    expect(screen.getByText('Verse')).toBeTruthy()
    expect(screen.getByText(/Phrase 1–Phrase 2/)).toBeTruthy()
    expect(screen.getAllByText(/Follow the ghost/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/metronome/i)).toBeNull()
  })

  it('asks to mark phrases before adding a section', () => {
    renderEditor([], [])
    expect(screen.getByText(/mark phrases before adding a section/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add section' })).toBeNull()
  })
})
