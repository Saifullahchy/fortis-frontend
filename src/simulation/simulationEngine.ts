import type { Vehicle } from '../types/domain'
export interface SimulationFrame {
  timestamp: number
  vehicles: Vehicle[]
}
export type SimulationListener = (frame: SimulationFrame) => void
export class SimulationEngine {
  private listeners = new Set<SimulationListener>()
  private timer: number | undefined
  constructor(private fleet: Vehicle[]) {}
  subscribe(listener: SimulationListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  start() {
    if (this.timer) return
    this.timer = window.setInterval(() => {
      this.fleet = this.fleet.map((v, i) =>
        v.status === 'offline'
          ? v
          : {
              ...v,
              heading: (v.heading + (i % 2 ? 1 : -1) + 360) % 360,
              battery: Math.max(0, v.battery - 0.01),
            },
      )
      const frame = { timestamp: Date.now(), vehicles: this.fleet }
      this.listeners.forEach(l => l(frame))
    }, 1000)
  }
  stop() {
    if (this.timer) window.clearInterval(this.timer)
    this.timer = undefined
  }
}
