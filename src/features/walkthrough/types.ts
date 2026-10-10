import type { AppDispatch } from '../../store'
import type { simulatorFor } from '../pages/missionSimulator'

/**
 * How a step moves on: the visitor presses Next, clicks the highlighted control, or the step
 * advances by itself once the narration has finished.
 */
export type Advance = 'next' | 'click' | 'auto'

export type Placement = 'auto' | 'top' | 'bottom' | 'left' | 'right'

/** What a step's `before` hook may do to the app before the callout shows. */
export interface StepContext {
  navigate: (path: string) => void
  dispatch: AppDispatch
  /** Resolve once the selector is in the DOM (or give up after `timeout` ms). */
  waitFor: (selector: string, timeout?: number) => Promise<Element | null>
  /** Click the first element matching the selector; false when nothing matched. */
  click: (selector: string) => Promise<boolean>
  /** Expand a FloatingPanel by its `data-panel-id` if it is collapsed. */
  openPanel: (id: string) => Promise<void>
  /** Collapse a FloatingPanel by its `data-panel-id` if it is open. */
  closePanel: (id: string) => Promise<void>
  sim: typeof simulatorFor
  sleep: (ms: number) => Promise<void>
}

export interface TourStep {
  id: string
  /** Route the step lives on; the tour navigates there first when it differs. */
  route?: string
  /** CSS selector of the control to spotlight. Without one the callout floats centred. */
  target?: string
  /** Wait for this selector before showing (defaults to `target`). */
  waitFor?: string
  title?: string
  text: string
  /** Narration script when it should differ from the on-screen text. */
  say?: string
  /** Short "Label: what it does" lines shown under the text, e.g. a breakdown of a control bar. */
  items?: string[]
  advance?: Advance
  placement?: Placement
  /** Runs after navigation and before the callout is shown. */
  before?: (ctx: StepContext) => unknown
  /** Extra settle time in ms after `before`, e.g. for a panel to expand. */
  settle?: number
  /** For click steps: advance when this becomes true instead of on the first click. */
  until?: (ctx: StepContext) => boolean
  /** Hint shown under the text on click steps (or any step that sets one). */
  hint?: string
  /** Let the visitor use the highlighted controls without the step advancing on a click. */
  interactive?: boolean
  /** Skip this step (moving forward) when it no longer applies, e.g. the flight already ended. */
  skipIf?: (ctx: StepContext) => boolean
  /**
   * Auto steps: minimum seconds to stay on the step, even if the narration finishes sooner, so the
   * visitor has time to read and watch. Defaults to a reading time based on the text length.
   */
  dwell?: number
}

export interface TourChapter {
  id: string
  title: string
  blurb: string
  /** Narration for the chapter intro card. */
  say?: string
  minutes: number
  steps: TourStep[]
}
