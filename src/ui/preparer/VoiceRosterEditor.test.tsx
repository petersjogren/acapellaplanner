import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceRosterEditor } from './VoiceRosterEditor.tsx'
import type { VoicePart } from '../../domain/schemas.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const soprano: VoicePart = {
  id: 's1',
  name: 'Soprano 1',
  shortLabel: 'S1',
  color: '#c23b2a',
  targetTakes: 4,
}

const alto: VoicePart = {
  id: 'a1',
  name: 'Alto 1',
  shortLabel: 'A1',
  color: '#4d6a8f',
  targetTakes: 3,
}

function fillAddForm(name: string, shortLabel: string, targetTakes?: string) {
  fireEvent.change(screen.getByLabelText('Part name'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Short label'), { target: { value: shortLabel } })
  if (targetTakes !== undefined) {
    fireEvent.change(screen.getByLabelText('Target doubles'), { target: { value: targetTakes } })
  }
}

function renderEditor(
  parts: VoicePart[] = [],
  handlers: Partial<ComponentProps<typeof VoiceRosterEditor>> = {},
) {
  const onAddPart = handlers.onAddPart ?? vi.fn()
  const onUpdatePart = handlers.onUpdatePart ?? vi.fn()
  const onRemovePart = handlers.onRemovePart ?? vi.fn()
  render(
    <VoiceRosterEditor
      parts={parts}
      onAddPart={onAddPart}
      onUpdatePart={onUpdatePart}
      onRemovePart={onRemovePart}
    />,
  )
  return { onAddPart, onUpdatePart, onRemovePart }
}

describe('VoiceRosterEditor', () => {
  it('adds a voice part with name, short label, color, and target doubles default 4', () => {
    const { onAddPart } = renderEditor()

    expect(screen.getByRole('heading', { name: 'Voice parts' })).toBeTruthy()
    expect(screen.queryByText(/users/i)).toBeNull()

    fillAddForm('Soprano 1', 'S1')
    fireEvent.click(screen.getByRole('button', { name: 'Add voice part' }))

    expect(onAddPart).toHaveBeenCalledTimes(1)
    expect(onAddPart).toHaveBeenCalledWith({
      name: 'Soprano 1',
      shortLabel: 'S1',
      color: '#c23b2a',
      targetTakes: 4,
    })
  })

  it('does not add a part without a name and short label', () => {
    const { onAddPart } = renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Add voice part' }))
    expect(onAddPart).not.toHaveBeenCalled()
  })

  it('rejects a duplicate short label with role=alert', () => {
    const { onAddPart } = renderEditor([soprano])
    fillAddForm('Soprano double', ' s1 ')
    fireEvent.click(screen.getByRole('button', { name: 'Add voice part' }))
    expect(onAddPart).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/already used/i)
  })

  it('edits an existing part', () => {
    const { onUpdatePart } = renderEditor([soprano])

    fireEvent.click(screen.getByRole('button', { name: 'Edit Soprano 1' }))
    fireEvent.change(screen.getAllByLabelText('Part name')[0]!, { target: { value: 'Alto 1' } })
    fireEvent.change(screen.getAllByLabelText('Short label')[0]!, { target: { value: 'A1' } })
    fireEvent.change(screen.getAllByLabelText('Target doubles')[0]!, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save part' }))

    expect(onUpdatePart).toHaveBeenCalledWith('s1', {
      name: 'Alto 1',
      shortLabel: 'A1',
      color: '#c23b2a',
      targetTakes: 2,
    })
  })

  it('rejects editing onto another part short label', () => {
    const { onUpdatePart } = renderEditor([soprano, alto])
    fireEvent.click(screen.getByRole('button', { name: 'Edit Alto 1' }))
    fireEvent.change(screen.getAllByLabelText('Short label')[0]!, { target: { value: 'S1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save part' }))
    expect(onUpdatePart).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/already used/i)
  })

  it('deletes a part after confirm', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onRemovePart } = renderEditor([soprano, alto])

    fireEvent.click(screen.getByRole('button', { name: 'Delete Soprano 1' }))
    expect(window.confirm).toHaveBeenCalled()
    expect(onRemovePart).toHaveBeenCalledWith('s1')
  })

  it('does not delete when confirm is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { onRemovePart } = renderEditor([soprano, alto])

    fireEvent.click(screen.getByRole('button', { name: 'Delete Soprano 1' }))
    expect(onRemovePart).not.toHaveBeenCalled()
  })
})
