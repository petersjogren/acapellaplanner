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

  it('asks the singer to get in position, then Line up — not clap', () => {
    renderPage({
      playBeep: vi.fn(),
      listenUntilPeak: vi.fn(),
    })

    expect(screen.getByRole('heading', { name: 'Line up headphones' })).toBeTruthy()
    expect(screen.getByText(/slip one cup so the mic hears the driver/)).toBeTruthy()
    expect(screen.queryByText(/^Clap with the tone/)).toBeNull()
    const measure = screen.getByRole('button', { name: 'Line up' })
    expect(measure.getAttribute('aria-label')).toBeNull()
    expect(screen.queryByLabelText(/Or type it/)).toBeNull()
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
    fireEvent.click(screen.getByRole('button', { name: 'Line up' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Listening…' })).toBeTruthy()
    })
    expect(screen.getByRole('status').textContent).toMatch(/Listening/)

    resolveListen(1040)
    await waitFor(() => {
      expect(screen.getByText(/Lined up by 40 ms/)).toBeTruthy()
    })
  })

  it('saves the profile on a successful Line up, without Keep', async () => {
    const io: ClapListenIo = {
      playBeep: vi.fn().mockResolvedValue(2000),
      listenUntilPeak: vi.fn().mockResolvedValue(2087),
    }

    renderPage(io)
    fireEvent.click(screen.getByRole('button', { name: 'Line up' }))

    await waitFor(() => {
      expect(screen.getByText(/Lined up by 87 ms/)).toBeTruthy()
    })
    expect(io.playBeep).toHaveBeenCalledTimes(1)
    expect(io.listenUntilPeak).toHaveBeenCalledWith(2000)
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull()

    const profile = loadDeviceProfile()
    expect(profile?.latencyCompMs).toBe(87)
    expect(profile?.userAgent).toBe(navigator.userAgent)
    expect(profile?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(localStorage.getItem(DEVICE_PROFILE_STORAGE_KEY)).toBeTruthy()
  })

  it('lets Line up again run another measurement', async () => {
    const io: ClapListenIo = {
      playBeep: vi.fn().mockResolvedValueOnce(1000).mockResolvedValueOnce(2000),
      listenUntilPeak: vi.fn().mockResolvedValueOnce(1040).mockResolvedValueOnce(2091),
    }

    renderPage(io)
    fireEvent.click(screen.getByRole('button', { name: 'Line up' }))
    await waitFor(() => {
      expect(screen.getByText(/Lined up by 40 ms/)).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Line up again' }))
    await waitFor(() => {
      expect(screen.getByText(/Lined up by 91 ms/)).toBeTruthy()
    })
    expect(io.playBeep).toHaveBeenCalledTimes(2)
  })

  it('says the mic did not pick up the tone when measurement fails', async () => {
    renderPage({
      playBeep: vi.fn().mockResolvedValue(1000),
      listenUntilPeak: vi.fn().mockResolvedValue(2000),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Line up' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/didn.t hear the tone/i)
    })
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull()
  })

  it('lets the singer type a value after a missed tone', async () => {
    renderPage({
      playBeep: vi.fn().mockResolvedValue(1000),
      listenUntilPeak: vi.fn().mockResolvedValue(2000),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Line up' }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })

    fireEvent.change(screen.getByLabelText(/Or type it/), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }))

    expect(loadDeviceProfile()?.latencyCompMs).toBe(120)
    await waitFor(() => {
      expect(screen.getByText(/Lined up by 120 ms/)).toBeTruthy()
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
