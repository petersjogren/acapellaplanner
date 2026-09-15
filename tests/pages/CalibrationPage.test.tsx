import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBrowserCalibrationIo,
  DEVICE_PROFILE_STORAGE_KEY,
  loadDeviceProfile,
  type ClapListenIo,
} from '../../src/audio/latency.ts'
import { CalibrationPage, type CalibrationPageIo } from '../../src/pages/CalibrationPage.tsx'

vi.mock('../../src/audio/latency.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/audio/latency.ts')>()
  return {
    ...actual,
    createBrowserCalibrationIo: vi.fn(),
  }
})

type TestIo = CalibrationPageIo

function renderPage(io?: TestIo) {
  return render(
    <MemoryRouter>
      <CalibrationPage io={io} />
    </MemoryRouter>,
  )
}

function deferredIo() {
  let resolve!: (value: CalibrationPageIo) => void
  const promise = new Promise<CalibrationPageIo>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('CalibrationPage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(createBrowserCalibrationIo).mockReset()
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

  it('reveals a mic meter after Check mic and hides the button', async () => {
    renderPage({
      playBeep: vi.fn(),
      listenUntilPeak: vi.fn(),
      getLevel: () => 0.5,
    })

    expect(screen.queryByRole('meter')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Check mic' }))

    await waitFor(() => {
      expect(screen.getByRole('meter')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Check mic' })).toBeNull()
    expect(screen.queryByText(/^Clap with the tone/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Line up' })).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('0.5')
    })
    expect(screen.getByText('living')).toBeTruthy()
  })

  it('shares one in-flight ensureIo and hides Check mic as soon as Line up starts', async () => {
    const pending = deferredIo()
    vi.mocked(createBrowserCalibrationIo).mockReturnValue(pending.promise)
    const created: CalibrationPageIo = {
      playBeep: vi.fn().mockResolvedValue(1000),
      listenUntilPeak: vi.fn().mockResolvedValue(1040),
      getLevel: () => 0.5,
      dispose: vi.fn(),
    }

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Check mic' }))
    fireEvent.click(screen.getByRole('button', { name: 'Line up' }))

    expect(createBrowserCalibrationIo).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Listening…' })).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Check mic' })).toBeNull()

    pending.resolve(created)
    await waitFor(() => {
      expect(screen.getByText(/Lined up by 40 ms/)).toBeTruthy()
    })
    expect(createBrowserCalibrationIo).toHaveBeenCalledTimes(1)
  })

  it('disposes page-created IO if unmounted before create resolves', async () => {
    const pending = deferredIo()
    vi.mocked(createBrowserCalibrationIo).mockReturnValue(pending.promise)
    const dispose = vi.fn()
    const created: CalibrationPageIo = {
      playBeep: vi.fn(),
      listenUntilPeak: vi.fn(),
      getLevel: () => 0,
      dispose,
    }

    const view = renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Line up' }))
    expect(createBrowserCalibrationIo).toHaveBeenCalledTimes(1)
    view.unmount()
    pending.resolve(created)

    await waitFor(() => {
      expect(dispose).toHaveBeenCalledTimes(1)
    })
  })

  it('leaves Check mic visible when permission fails', async () => {
    vi.mocked(createBrowserCalibrationIo).mockRejectedValue(new Error('NotAllowedError'))

    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Check mic' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Check mic' })).toBeTruthy()
    })
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says the mic is silent when measurement fails and getLevel stays at 0', async () => {
    renderPage({
      playBeep: vi.fn().mockResolvedValue(1000),
      listenUntilPeak: vi.fn().mockResolvedValue(2000),
      getLevel: () => 0,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Line up' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Mic is silent/i)
    })
    expect(screen.getByRole('alert').textContent).not.toMatch(/didn.t hear the tone/i)
    expect(screen.getByLabelText(/Or type it/)).toBeTruthy()
  })

  it('offers Tone and Clap with the click', () => {
    renderPage({
      playBeep: vi.fn(),
      listenUntilPeak: vi.fn(),
    })

    const tone = screen.getByRole('button', { name: 'Tone' })
    const clap = screen.getByRole('button', { name: 'Clap with the click' })
    expect(tone.getAttribute('aria-pressed')).toBe('true')
    expect(clap.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText(/slip one cup so the mic hears the driver/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Line up' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check mic' })).toBeTruthy()

    fireEvent.click(clap)
    expect(clap.getAttribute('aria-pressed')).toBe('true')
    expect(tone.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText(/clap once on each click/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check mic' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Line up' })).toBeNull()
  })

  it('clap mode auto-saves stable estimate', async () => {
    const runClickClapMeasure = vi.fn().mockResolvedValue({
      latencyMs: 92,
      matchCount: 16,
      madMs: 6,
      iqrMs: 10,
      stable: true,
      nInliers: 16,
      posteriorStdMs: 3,
    })
    const playBeep = vi.fn()

    renderPage({
      playBeep,
      listenUntilPeak: vi.fn(),
      getLevel: () => 0.2,
      captureIsProcessed: false,
      runClickClapMeasure,
      dispose: vi.fn(),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clap with the click' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => {
      expect(screen.getByText(/Lined up by 92 ms on this device/)).toBeTruthy()
    })
    expect(loadDeviceProfile()?.latencyCompMs).toBe(92)
    expect(playBeep).not.toHaveBeenCalled()
    expect(runClickClapMeasure).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Start again' })).toBeTruthy()
  })

  it('clap failure shows lock copy and type-ms', async () => {
    renderPage({
      playBeep: vi.fn(),
      listenUntilPeak: vi.fn(),
      getLevel: () => 0.2,
      captureIsProcessed: true,
      runClickClapMeasure: vi.fn().mockRejectedValue(new Error('failed measurement')),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clap with the click' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/couldn.t lock the timing/i)
    })
    expect(screen.getByRole('alert').textContent).toMatch(/switch to Tone/)
    expect(screen.getByRole('alert').textContent).not.toMatch(/blocking the tone/i)
    expect(screen.getByLabelText(/Or type it/)).toBeTruthy()
  })

  it('treats missing runClickClapMeasure as clap fail', async () => {
    renderPage({
      playBeep: vi.fn(),
      listenUntilPeak: vi.fn(),
      getLevel: () => 0.4,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clap with the click' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/couldn.t lock the timing/i)
    })
    expect(screen.getByLabelText(/Or type it/)).toBeTruthy()
  })

  it('silent mic still wins on clap fail when getLevel stays at 0', async () => {
    renderPage({
      playBeep: vi.fn(),
      listenUntilPeak: vi.fn(),
      getLevel: () => 0,
      runClickClapMeasure: vi.fn().mockRejectedValue(new Error('failed measurement')),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clap with the click' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Mic is silent/i)
    })
    expect(screen.getByRole('alert').textContent).not.toMatch(/couldn.t lock/i)
    expect(screen.getByLabelText(/Or type it/)).toBeTruthy()
  })

  it('announces Clap with the clicks while measuring and disables mode switch', async () => {
    let resolveMeasure: (value: {
      latencyMs: number
      matchCount: number
      madMs: number
      iqrMs: number
      stable: boolean
      nInliers: number
      posteriorStdMs: number
    }) => void = () => undefined

    renderPage({
      playBeep: vi.fn(),
      listenUntilPeak: vi.fn(),
      runClickClapMeasure: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveMeasure = resolve
          }),
      ),
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clap with the click' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Listening…' })).toBeTruthy()
    })
    expect(screen.getByRole('status').textContent).toMatch(/clapping with the clicks/i)
    expect((screen.getByRole('button', { name: 'Tone' }) as HTMLButtonElement).disabled).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Clap with the click' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    resolveMeasure({
      latencyMs: 40,
      matchCount: 16,
      madMs: 4,
      iqrMs: 8,
      stable: true,
      nInliers: 16,
      posteriorStdMs: 2,
    })
    await waitFor(() => {
      expect(screen.getByText(/Lined up by 40 ms/)).toBeTruthy()
    })
    expect((screen.getByRole('button', { name: 'Tone' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
