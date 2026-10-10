/**
 * Step narration. A pre-generated clip at /walkthrough/audio/<stepId>.mp3 is used when present;
 * otherwise the browser's speech synthesis reads the script. When muted, a silent timer of the
 * same length keeps auto-advancing steps on schedule.
 */

export interface PlayOptions {
  muted: boolean
  onProgress: (seconds: number, duration: number) => void
  onEnd: () => void
}

export type Stop = () => void

const WORDS_PER_SECOND = 2.6
const missingClips = new Set<string>()

export const estimateSeconds = (text: string) =>
  Math.max(2.5, text.trim().split(/\s+/).length / WORDS_PER_SECOND + 0.6)

/**
 * Deep male voices first: a clipped, authoritative briefing voice suits the product. The order
 * covers Windows (Microsoft natural voices), Chrome (Google) and macOS (Daniel, Reed, Rocko …).
 */
const MALE_VOICES = [
  'Microsoft Guy Online (Natural) - English (United States)',
  'Microsoft Christopher Online (Natural) - English (United States)',
  'Microsoft Ryan Online (Natural) - English (United Kingdom)',
  'Microsoft Eric Online (Natural) - English (United States)',
  'Google UK English Male',
  'Google US English Male',
  'Alex',
  'Daniel',
  'Reed (English (United States))',
  'Rocko (English (United States))',
  'Eddy (English (United States))',
  'Microsoft David - English (United States)',
  'Microsoft Mark - English (United States)',
  'Fred',
  'Ralph',
]
/** Delivery: lower and a touch slower than default reads as a hard, steady briefing voice. */
const PITCH = 0.78
const RATE = 0.96
const VOICE_KEY = 'fortis.walkthrough.voice'

export const listVoices = () =>
  (window.speechSynthesis?.getVoices() ?? []).filter(v => v.lang.toLowerCase().startsWith('en'))

export function getVoiceName(): string | null {
  try {
    return window.localStorage.getItem(VOICE_KEY)
  } catch {
    return null
  }
}
export function setVoiceName(name: string | null) {
  try {
    if (name) window.localStorage.setItem(VOICE_KEY, name)
    else window.localStorage.removeItem(VOICE_KEY)
  } catch {
    /* preference only */
  }
}

/** The voice the narrator will use: the operator's pick, else the best male voice installed. */
export function pickVoice(): SpeechSynthesisVoice | null {
  const voices = listVoices()
  const chosen = getVoiceName()
  if (chosen) {
    const v = voices.find(voice => voice.name === chosen)
    if (v) return v
  }
  for (const name of MALE_VOICES) {
    const v = voices.find(voice => voice.name === name)
    if (v) return v
  }
  return (
    voices.find(
      v => /male|guy|david|daniel|james|george/i.test(v.name) && !/female/i.test(v.name),
    ) ??
    voices.find(v => v.lang === 'en-US') ??
    voices[0] ??
    null
  )
}

/** Names from the preferred list that are installed here, so a picker can group them first. */
export const preferredVoiceNames = () => {
  const installed = new Set(listVoices().map(v => v.name))
  return MALE_VOICES.filter(name => installed.has(name))
}

function playTimer(seconds: number, opts: PlayOptions): Stop {
  const started = performance.now()
  let raf = 0
  const tick = () => {
    const t = (performance.now() - started) / 1000
    if (t >= seconds) {
      opts.onProgress(seconds, seconds)
      opts.onEnd()
      return
    }
    opts.onProgress(t, seconds)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(raf)
}

function playSpeech(text: string, opts: PlayOptions): Stop {
  const synth = window.speechSynthesis
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined')
    return playTimer(estimateSeconds(text), opts)
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  const voice = pickVoice()
  if (voice) utterance.voice = voice
  utterance.rate = RATE
  utterance.pitch = PITCH
  const estimate = estimateSeconds(text)
  const started = performance.now()
  let done = false
  let raf = 0
  const tick = () => {
    const t = Math.min((performance.now() - started) / 1000, estimate - 0.05)
    opts.onProgress(t, estimate)
    raf = requestAnimationFrame(tick)
  }
  let fallback: Stop | null = null
  let guard = 0
  const finish = () => {
    if (done) return
    done = true
    cancelAnimationFrame(raf)
    opts.onProgress(estimate, estimate)
    opts.onEnd()
  }
  /** Speech that dies in its first second (no audio device, engine error) must not rush the tour. */
  const bail = () => {
    if (done) return
    const elapsed = (performance.now() - started) / 1000
    if (elapsed < Math.max(1, estimate * 0.25)) {
      done = true
      cancelAnimationFrame(raf)
      window.clearTimeout(guard)
      fallback = playTimer(Math.max(estimate - elapsed, 1), {
        ...opts,
        onProgress: (at, duration) => opts.onProgress(at + elapsed, duration + elapsed),
      })
      return
    }
    finish()
  }
  utterance.onend = bail
  utterance.onerror = bail
  raf = requestAnimationFrame(tick)
  // Some engines never fire onend if the tab is backgrounded: cap at a generous estimate.
  guard = window.setTimeout(finish, estimate * 1000 * 1.8 + 1500)
  synth.speak(utterance)
  return () => {
    done = true
    cancelAnimationFrame(raf)
    window.clearTimeout(guard)
    fallback?.()
    synth.cancel()
  }
}

function playClip(id: string, text: string, opts: PlayOptions): Stop {
  const audio = new Audio(`/walkthrough/audio/${id}.mp3`)
  let fallback: Stop | null = null
  let settled = false
  const onTime = () => {
    if (!settled) settled = true
    opts.onProgress(audio.currentTime, audio.duration || estimateSeconds(text))
  }
  const onEnd = () => opts.onEnd()
  const onError = () => {
    missingClips.add(id)
    cleanup()
    fallback = playSpeech(text, opts)
  }
  const cleanup = () => {
    audio.removeEventListener('timeupdate', onTime)
    audio.removeEventListener('ended', onEnd)
    audio.removeEventListener('error', onError)
    audio.pause()
  }
  audio.addEventListener('timeupdate', onTime)
  audio.addEventListener('ended', onEnd)
  audio.addEventListener('error', onError)
  audio.play().catch(onError)
  return () => {
    cleanup()
    fallback?.()
  }
}

export function play(id: string, text: string, opts: PlayOptions): Stop {
  if (opts.muted) return playTimer(estimateSeconds(text), opts)
  if (missingClips.has(id)) return playSpeech(text, opts)
  return playClip(id, text, opts)
}

/** Browsers only list voices after the first getVoices() call; warm it up early. */
export function warmVoices() {
  try {
    window.speechSynthesis?.getVoices()
  } catch {
    /* no speech support */
  }
}
