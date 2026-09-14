import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEVICE_PROFILE_STORAGE_KEY,
  loadDeviceProfile,
  type ClapListenIo,
} from '../../src/audio/latency.ts'
import { CalibrationPage } from '../../src/pages/CalibrationPage.tsx'

function renderPage(io: ClapListenIo) {
  return render(
    <MemoryRouter>
      <CalibrationPage io={io} />
    </MemoryRouter>,
  )
}

describe('CalibrationPage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('asks the singer to bleed the tone into the mic, not clap', () => {
    renderPage({
      playBeep: vi.fn(),
      listenUntilPeak: vi.fn(),
    })

    expect(screen.getByRole('heading', { name: 'Line up headphones' })).toBeTruthy()
    expect(screen.getByText(/hold your microphone up to your headphone speaker/)).toBeTruthy()
    expect(screen.queryByText(/^Clap with the tone/)).toBeNull()
    const measure = screen.getByRole('button', { name: 'Play the tone' })
    expect(measure.getAttribute('aria-label')).toBeNull()
  })

  it('announces Listening while measuring', async () => {
    let resolveListen: (ms: number) => void = () => undefined
    const io: ClapListenIo = {
      playBeep: vi.fn().mockResolvedValue(1000),
      listenUntilPeak: vi.fn(
        () =>
          new Promise<number>((resolve) => {
            resolveListen = resolve
          }),
      ),
    }

    renderPage(io)
    fireEvent.click(screen.getByRole('button', { name: 'Play the tone' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Listening…' })).toBeTruthy()
    })
    expect(screen.getByRole('status').textContent).toMatch(/Listening/)

    resolveListen(1040)
    await waitFor(() => {
      expect(screen.getByText('40 ms')).toBeTruthy()
    })
  })

  it('shows the measured ms after a clap and Keep saves the profile', async () => {
    const io: ClapListenIo = {
      playBeep: vi.fn().mockResolvedValue(2000),
      listenUntilPeak: vi.fn().mockResolvedValue(2087),
    }

    renderPage(io)
    fireEvent.click(screen.getByRole('button', { name: 'Play the tone' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Measured latency' })).toBeTruthy()
      expect(screen.getByText('87 ms')).toBeTruthy()
    })
    expect(screen.getByText('87 ms').getAttribute('aria-label')).toBeNull()
    expect(io.playBeep).toHaveBeenCalledTimes(1)
    expect(io.listenUntilPeak).toHaveBeenCalledWith(2000)

    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))

    const profile = loadDeviceProfile()
    expect(profile?.latencyCompMs).toBe(87)
    expect(profile?.userAgent).toBe(navigator.userAgent)
    expect(profile?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(localStorage.getItem(DEVICE_PROFILE_STORAGE_KEY)).toBeTruthy()
  })

  it('lets Try again run another measurement', async () => {
    const io: ClapListenIo = {
      playBeep: vi.fn().mockResolvedValueOnce(1000).mockResolvedValueOnce(2000),
      listenUntilPeak: vi.fn().mockResolvedValueOnce(1040).mockResolvedValueOnce(2091),
    }

    renderPage(io)
    fireEvent.click(screen.getByRole('button', { name: 'Play the tone' }))
    await waitFor(() => {
      expect(screen.getByText('40 ms')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => {
      expect(screen.getByText('91 ms')).toBeTruthy()
    })
    expect(io.playBeep).toHaveBeenCalledTimes(2)
  })

  it('says the mic did not pick up the tone when measurement fails', async () => {
    renderPage({
      playBeep: vi.fn().mockResolvedValue(1000),
      listenUntilPeak: vi.fn().mockResolvedValue(2000),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Play the tone' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/didn.t hear the tone/i)
    })
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull()
  })
})
