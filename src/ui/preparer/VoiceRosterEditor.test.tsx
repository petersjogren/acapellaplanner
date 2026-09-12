import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceRosterEditor } from './VoiceRosterEditor.tsx'
import type { VoicePart } from '../../domain/schemas.ts'

afterEach(() => {
  cleanup()
})

function fillAddForm(name: string, shortLabel: string, targetTakes?: string) {
  fireEvent.change(screen.getByLabelText('Part name'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Short label'), { target: { value: shortLabel } })
  if (targetTakes !== undefined) {
    fireEvent.change(screen.getByLabelText('Target doubles'), { target: { value: targetTakes } })
  }
}

describe('VoiceRosterEditor', () => {
  it('adds a voice part with name, short label, color, and target doubles default 4', () => {
    const onChange = vi.fn()
    render(<VoiceRosterEditor parts={[]} onChange={onChange} />)

    expect(screen.getByRole('heading', { name: 'Voice parts' })).toBeTruthy()
    expect(screen.queryByText(/users/i)).toBeNull()

    fillAddForm('Soprano 1', 'S1')
    fireEvent.click(screen.getByRole('button', { name: 'Add voice part' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    const next = onChange.mock.calls[0]?.[0] as VoicePart[]
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({
      name: 'Soprano 1',
      shortLabel: 'S1',
      targetTakes: 4,
    })
    expect(next[0]?.id.length).toBeGreaterThan(0)
    expect(next[0]?.color.length).toBeGreaterThan(0)
  })

  it('does not add a part without a name and short label', () => {
    const onChange = vi.fn()
    render(<VoiceRosterEditor parts={[]} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add voice part' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('edits an existing part', () => {
    const onChange = vi.fn()
    render(
      <VoiceRosterEditor
        parts={[{ id: 's1', name: 'Soprano 1', shortLabel: 'S1', color: '#c23b2a', targetTakes: 4 }]}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit Soprano 1' }))
    fireEvent.change(screen.getAllByLabelText('Part name')[0]!, { target: { value: 'Alto 1' } })
    fireEvent.change(screen.getAllByLabelText('Short label')[0]!, { target: { value: 'A1' } })
    fireEvent.change(screen.getAllByLabelText('Target doubles')[0]!, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save part' }))

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 's1',
        name: 'Alto 1',
        shortLabel: 'A1',
        targetTakes: 2,
      }),
    ])
  })

  it('deletes a part', () => {
    const onChange = vi.fn()
    render(
      <VoiceRosterEditor
        parts={[
          { id: 's1', name: 'Soprano 1', shortLabel: 'S1', color: '#c23b2a', targetTakes: 4 },
          { id: 'a1', name: 'Alto 1', shortLabel: 'A1', color: '#4d6a8f', targetTakes: 3 },
        ]}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete Soprano 1' }))
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'a1', name: 'Alto 1' }),
    ])
  })
})
