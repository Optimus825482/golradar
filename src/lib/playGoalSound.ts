let audioCtx: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume()
  }
  return audioCtx
}

/**
 * Play short "goal" chime using Web Audio API.
 * No external files needed. Browsers require user gesture first (click/tap)
 * to create AudioContext — works because user already interacted.
 */
export function playGoalSound() {
  try {
    const ctx = getAudioContext()
    const now = ctx.currentTime

    // --- Two-tone ascending chime (C5 → E5 → G5) ---
    const notes = [523.25, 659.25, 783.99] // C5, E5, G5
    const noteDuration = 0.12
    const gap = 0.08

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'triangle'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, now + i * (noteDuration + gap))
      gain.gain.linearRampToValueAtTime(0.3, now + i * (noteDuration + gap) + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * (noteDuration + gap) + noteDuration)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + i * (noteDuration + gap))
      osc.stop(now + i * (noteDuration + gap) + noteDuration)
    })

    // --- Add short "thud" (low sine) for weight ---
    const bass = ctx.createOscillator()
    const bassGain = ctx.createGain()
    bass.type = 'sine'
    bass.frequency.value = 130.81 // C3
    bassGain.gain.setValueAtTime(0, now)
    bassGain.gain.linearRampToValueAtTime(0.4, now + 0.02)
    bassGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2)
    bass.connect(bassGain)
    bassGain.connect(ctx.destination)
    bass.start(now)
    bass.stop(now + 0.2)
  } catch {
    // Silently fail — audio not critical
  }
}
