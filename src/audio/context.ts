let singleton: AudioContext | null = null

export function getAudioContext(): AudioContext {
  if (!singleton || singleton.state === 'closed') {
    singleton = new AudioContext()
  }
  return singleton
}

// 100 samples (~12.5 ms) of silence, 8-bit unsigned mono PCM WAVE — same
// unmute-ios-audio trick, but with real sample data. A zero-length data
// chunk plays instantly and never actually holds the "media" session; this
// one loops audibly-but-silently for as long as the tab is open.
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRogAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YWQAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA'

let iosUnlockAudio: HTMLAudioElement | null = null
let iosUnlockAttempted = false

/**
 * iOS Safari routes plain Web Audio (AudioContext output) through the
 * "ambient" audio session category, which the hardware Ring/Silent switch
 * mutes. Only <audio>/<video> elements play in the "media" category, which
 * ignores the switch. Looping a silent <audio> element from the first user
 * gesture flips the whole page over to the "media" category, so every later
 * AudioContext source (ghost playback, click, takes) is heard even with the
 * switch set to silent. No-op (and harmless) everywhere else, including when
 * called before any user gesture — it just retries on the next call.
 */
export function unlockIOSAudioSession(): void {
  if (iosUnlockAttempted || typeof Audio === 'undefined') return
  iosUnlockAttempted = true
  try {
    const audio = new Audio(SILENT_WAV_DATA_URI)
    audio.loop = true
    audio.setAttribute('playsinline', 'true')
    // Keep the silent loop out of the iOS lock-screen / Control Center widget.
    audio.setAttribute('x-webkit-airplay', 'deny')
    iosUnlockAudio = audio
    void audio.play().catch(() => {
      // Called outside a user gesture, or the browser refused — allow retry.
      iosUnlockAttempted = false
      iosUnlockAudio = null
    })
  } catch {
    iosUnlockAttempted = false
    iosUnlockAudio = null
  }
}

/** Test-only: undo unlockIOSAudioSession's module state between specs. */
export function resetIOSAudioUnlockForTests(): void {
  iosUnlockAudio?.pause()
  iosUnlockAudio = null
  iosUnlockAttempted = false
}

export async function resumeAudioContext(ctx: AudioContext = getAudioContext()): Promise<AudioContext> {
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }
  return ctx
}

export async function closeAudioContext(): Promise<void> {
  const ctx = singleton
  singleton = null
  if (ctx && ctx.state !== 'closed') {
    await ctx.close()
  }
}
