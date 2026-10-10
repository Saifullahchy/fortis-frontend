#!/usr/bin/env node
/**
 * Generate narration MP3s for the walkthrough from its script, so text and audio never drift.
 *
 *   OPENAI_API_KEY=...            node scripts/gen-narration.mjs            (OpenAI TTS)
 *   ELEVENLABS_API_KEY=... [ELEVENLABS_VOICE_ID=...] node scripts/gen-narration.mjs
 *
 * Options: --force (regenerate existing clips), --only <stepId>.
 * Output: public/walkthrough/audio/<stepId>.mp3
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const OUT = path.join(ROOT, 'public/walkthrough/audio')
const SCRIPT = path.join(ROOT, 'src/features/walkthrough/script.ts')
const args = process.argv.slice(2)
const force = args.includes('--force')
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null

/** Pull { id, text } pairs out of script.ts without a TypeScript toolchain. */
async function readLines() {
  const src = await readFile(SCRIPT, 'utf8')
  const lines = []
  // Chapter intros: id + title + blurb.
  for (const m of src.matchAll(
    /id:\s*'([\w-]+)',\s*title:\s*'([^']+)',\s*blurb:\s*'((?:[^'\\]|\\.)+)'/g,
  )) {
    lines.push({ id: `${m[1]}-intro`, text: `${m[2]}. ${m[3]}` })
  }
  // Steps: id, then the first `say:` or `text:` that follows before the next id.
  const stepRe = /id:\s*'([\w-]+)'([\s\S]*?)(?=\n\s*\{\s*\n\s*id:|\n\s*\],)/g
  for (const m of src.matchAll(stepRe)) {
    if (lines.some(l => l.id === `${m[1]}-intro`)) continue
    const body = m[2]
    const say = body.match(/say:\s*'((?:[^'\\]|\\.)+)'/)
    const text = body.match(/text:\s*'((?:[^'\\]|\\.)+)'/)
    const chosen = (say ?? text)?.[1]
    if (chosen) lines.push({ id: m[1], text: chosen.replace(/\\'/g, "'") })
  }
  return lines
}

async function openai(text) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
      // onyx is the deepest male OpenAI voice.
      voice: process.env.OPENAI_TTS_VOICE ?? 'onyx',
      input: text,
      response_format: 'mp3',
      instructions:
        'Deep, hard male voice: a military operations briefing. Authoritative, clipped, steady pace, flat delivery. No warmth, no enthusiasm, no sales tone.',
    }),
  })
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

async function elevenlabs(text) {
  // Default: ElevenLabs' premade "Adam" (deep male). Override with ELEVENLABS_VOICE_ID.
  const voice = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2',
      voice_settings: { stability: 0.75, similarity_boost: 0.8, style: 0.15 },
    }),
  })
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`)
  return Buffer.from(await res.arrayBuffer())
}

const synth = process.env.OPENAI_API_KEY
  ? openai
  : process.env.ELEVENLABS_API_KEY
    ? elevenlabs
    : null
if (!synth) {
  console.error('Set OPENAI_API_KEY, or ELEVENLABS_API_KEY (optionally ELEVENLABS_VOICE_ID).')
  process.exit(1)
}

await mkdir(OUT, { recursive: true })
const lines = (await readLines()).filter(l => !only || l.id === only)
let made = 0
for (const line of lines) {
  const file = path.join(OUT, `${line.id}.mp3`)
  const exists = await stat(file).then(
    () => true,
    () => false,
  )
  if (exists && !force) continue
  process.stdout.write(`${line.id} … `)
  await writeFile(file, await synth(line.text))
  made += 1
  console.log('ok')
}
console.log(`${made} clip(s) written, ${lines.length - made} already present.`)
