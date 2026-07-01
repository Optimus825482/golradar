let audioCtx: AudioContext | null = null
let unlockArmed = false

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
 * Arm audio unlock on the first user gesture (click/tap/keydown).
 * Modern browsers (Chrome/Safari/Firefox) refuse to start an AudioContext
 * without prior user interaction. Without this call, the FIRST goal
 * after page load plays silently even though playGoalSound() was called.
 *
 * Idempotent — safe to call from multiple event handlers.
 */
export function armAudioUnlock(): void {
  if (typeof window === 'undefined') return
  if (unlockArmed) return
  unlockArmed = true
  const unlock = () => {
    try {
      // Construct the context lazily on the gesture, then resume.
      const ctx = getAudioContext()
      if (ctx.state === 'suspended') {
        void ctx.resume()
      }
    } catch {
      // best-effort — sound is non-critical
    }
    // Detach after first successful gesture so we don't pay the cost
    // on every subsequent click.
    window.removeEventListener('click', unlock)
    window.removeEventListener('keydown', unlock)
    window.removeEventListener('touchstart', unlock)
  }
  window.addEventListener('click', unlock, { once: true, passive: true })
  window.addEventListener('keydown', unlock, { once: true, passive: true })
  window.addEventListener('touchstart', unlock, { once: true, passive: true })
}

/**
 * Play short "goal" chime using Web Audio API.
 * No external files needed. Browsers require user gesture first (click/tap)
 * to create AudioContext — call `armAudioUnlock()` once at app start to
 * guarantee the first goal sound actually plays.
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
