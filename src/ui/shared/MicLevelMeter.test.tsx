import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MicLevelMeter } from './MicLevelMeter.tsx'

afterEach(() => {
  cleanup()
})

function fillWidth(meter: HTMLElement): string {
  const fill = meter.querySelector('[style]') as HTMLElement | null
  return fill?.style.width ?? ''
}

describe('MicLevelMeter', () => {
  it('exposes a meter with a 0..1 range', () => {
    render(<MicLevelMeter level={0} living={false} />)

    const meter = screen.getByRole('meter')
    expect(meter.getAttribute('aria-valuemin')).toBe('0')
    expect(meter.getAttribute('aria-valuemax')).toBe('1')
  })

  it('shows an empty fill at level 0', () => {
    render(<MicLevelMeter level={0} living={false} />)

    const meter = screen.getByRole('meter')
    expect(meter.getAttribute('aria-valuenow')).toBe('0')
    expect(fillWidth(meter)).toBe('0%')
  })

  it('maps level 0.8 to 80% fill', () => {
    render(<MicLevelMeter level={0.8} living={false} />)

    const meter = screen.getByRole('meter')
    expect(meter.getAttribute('aria-valuenow')).toBe('0.8')
    expect(fillWidth(meter)).toBe('80%')
  })

  it('clamps level below 0 to 0', () => {
    render(<MicLevelMeter level={-0.2} living={false} />)

    const meter = screen.getByRole('meter')
    expect(meter.getAttribute('aria-valuenow')).toBe('0')
    expect(fillWidth(meter)).toBe('0%')
  })

  it('clamps level above 1 to 1', () => {
    render(<MicLevelMeter level={1.4} living={false} />)

    const meter = screen.getByRole('meter')
    expect(meter.getAttribute('aria-valuenow')).toBe('1')
    expect(fillWidth(meter)).toBe('100%')
  })

  it('shows living or quiet from the living prop', () => {
    const { rerender } = render(<MicLevelMeter level={0.5} living={true} />)
    expect(screen.getByText('living')).toBeTruthy()

    rerender(<MicLevelMeter level={0.5} living={false} />)
    expect(screen.getByText('quiet')).toBeTruthy()
    expect(screen.queryByText('living')).toBeNull()
  })

  it('uses a custom label as the accessible name', () => {
    render(<MicLevelMeter level={0} living={false} label="Booth mic" />)

    expect(screen.getByRole('meter', { name: 'Booth mic' })).toBeTruthy()
  })
})
