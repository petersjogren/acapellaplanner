import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SectionEditor } from './SectionEditor.tsx'
import type { Section } from '../../domain/schemas.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const verse: Section = {
  id: 's1',
  name: 'Verse',
  timeMode: 'ghost-follow',
  startMs: 0,
  endMs: 4000,
  clickEnabled: false,
}

function renderEditor(
  sections: Section[] = [],
  handlers: Partial<ComponentProps<typeof SectionEditor>> = {},
) {
  const onAddSection = handlers.onAddSection ?? vi.fn()
  const onRemoveSection = handlers.onRemoveSection ?? vi.fn()
  render(
    <SectionEditor
      sections={sections}
      durationMs={8000}
      onAddSection={onAddSection}
      onRemoveSection={onRemoveSection}
    />,
  )
  return { onAddSection, onRemoveSection }
}

describe('SectionEditor', () => {
  it('adds a fixed-tempo section with click', () => {
    const { onAddSection } = renderEditor()

    expect(screen.getByRole('heading', { name: 'Sections' })).toBeTruthy()
    expect(screen.queryByText(/metronome/i)).toBeNull()
    expect(screen.getByRole('option', { name: 'In time' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Follow the ghost' })).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Section name'), { target: { value: 'Tag' } })
    fireEvent.change(screen.getByLabelText('Time feel'), { target: { value: 'fixed-tempo' } })
    fireEvent.change(screen.getByLabelText('BPM'), { target: { value: '120' } })
    fireEvent.click(screen.getByLabelText('Click'))
    fireEvent.change(screen.getByLabelText('Start (ms)'), { target: { value: '1000' } })
    fireEvent.change(screen.getByLabelText('End (ms)'), { target: { value: '8000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))

    expect(onAddSection).toHaveBeenCalledTimes(1)
    expect(onAddSection).toHaveBeenCalledWith({
      name: 'Tag',
      timeMode: 'fixed-tempo',
      fixedBpm: 120,
      startMs: 1000,
      endMs: 8000,
      clickEnabled: true,
    })
  })

  it('does not add a section without a name', () => {
    const { onAddSection } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
    expect(onAddSection).not.toHaveBeenCalled()
  })

  it('lists existing sections without metronome copy', () => {
    renderEditor([verse])
    expect(screen.getByText('Verse')).toBeTruthy()
    expect(screen.getAllByText(/Follow the ghost/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/metronome/i)).toBeNull()
  })
})
