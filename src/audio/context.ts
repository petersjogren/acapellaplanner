let singleton: AudioContext | null = null

export function getAudioContext(): AudioContext {
  if (!singleton || singleton.state === 'closed') {
    singleton = new AudioContext()
  }
  return singleton
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
