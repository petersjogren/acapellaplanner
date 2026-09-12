import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GHOST_FOCUS_PRESET_ID, STACK_BUILD_PRESET_ID } from '../../audio/mix.ts'
import { MixPresetSelect } from './MixPresetSelect.tsx'

afterEach(() => {
  cleanup()
})

describe('MixPresetSelect', () => {
  it('renders three named headphone mix options', () => {
    render(<MixPresetSelect value={GHOST_FOCUS_PRESET_ID} onChange={vi.fn()} />)

    expect(screen.getByRole('combobox', { name: 'Headphones' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Ghost Focus' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Stack Build' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'Blend Check' })).toBeTruthy()
  })

  it('notifies when the selected preset changes', () => {
    const onChange = vi.fn()
    render(<MixPresetSelect value={GHOST_FOCUS_PRESET_ID} onChange={onChange} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Headphones' }), {
      target: { value: STACK_BUILD_PRESET_ID },
    })
    expect(onChange).toHaveBeenCalledWith(STACK_BUILD_PRESET_ID)
  })
})
