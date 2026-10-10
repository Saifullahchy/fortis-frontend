import { useEffect, useState } from 'react'
import { getVoiceName, listVoices, pickVoice, preferredVoiceNames, setVoiceName } from './narration'

/**
 * Lets the operator choose which installed voice reads the narration. Recommended (male) voices
 * are listed first; the choice persists and takes effect on the next step or replay.
 */
export function VoicePicker({ onChange, compact }: { onChange?: () => void; compact?: boolean }) {
  const [voices, setVoices] = useState(listVoices)
  const [chosen, setChosen] = useState(() => getVoiceName() ?? pickVoice()?.name ?? '')

  useEffect(() => {
    const synth = window.speechSynthesis
    if (!synth) return
    const refresh = () => {
      setVoices(listVoices())
      setChosen(c => c || pickVoice()?.name || '')
    }
    refresh()
    synth.addEventListener('voiceschanged', refresh)
    return () => synth.removeEventListener('voiceschanged', refresh)
  }, [])

  if (!voices.length) return null
  const preferred = preferredVoiceNames()
  const others = voices.filter(v => !preferred.includes(v.name))
  const label = (v: SpeechSynthesisVoice) => v.name.replace(/ \(English \((.*?)\)\)/, ' · $1')

  return (
    <label className={`wt-voice${compact ? ' compact' : ''}`} title="Narration voice">
      {!compact && <span>Voice</span>}
      <select
        value={chosen}
        onChange={event => {
          const name = event.target.value
          setChosen(name)
          setVoiceName(name || null)
          onChange?.()
        }}
      >
        {preferred.length > 0 && (
          <optgroup label="Recommended">
            {preferred.map(name => {
              const v = voices.find(voice => voice.name === name)!
              return (
                <option key={name} value={name}>
                  {label(v)}
                </option>
              )
            })}
          </optgroup>
        )}
        <optgroup label="All English voices">
          {others.map(v => (
            <option key={v.name} value={v.name}>
              {label(v)} · {v.lang}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  )
}
