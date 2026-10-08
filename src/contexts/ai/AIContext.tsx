import { createContext, useContext, type ReactNode } from 'react'
export interface AIAnalysisResult {
  summary: string
  confidence: number
  recommendations: string[]
}
export interface AIContextValue {
  isAvailable: boolean
  isProcessing: boolean
  analyzeVehicle(id: string): Promise<AIAnalysisResult>
  analyzeMission(id: string): Promise<AIAnalysisResult>
  analyzeConfiguration(id: string): Promise<AIAnalysisResult>
  explainDiagnostic(id: string): Promise<string>
  askAssistant(prompt: string): Promise<string>
}
const mock: AIContextValue = {
  isAvailable: false,
  isProcessing: false,
  async analyzeVehicle() {
    return {
      summary: 'Mock analysis boundary ready.',
      confidence: 0.91,
      recommendations: ['Review primary link redundancy.'],
    }
  },
  async analyzeMission() {
    return {
      summary: 'Mission profile is within simulated constraints.',
      confidence: 0.87,
      recommendations: [],
    }
  },
  async analyzeConfiguration() {
    return {
      summary: 'One non-blocking warning found.',
      confidence: 0.94,
      recommendations: ['Add a redundant localization source.'],
    }
  },
  async explainDiagnostic() {
    return 'LTE quality is below the configured advisory threshold.'
  },
  async askAssistant() {
    return 'The assistant is operating in mock mode.'
  },
}
const AIContext = createContext<AIContextValue>(mock)
export function AIProvider({ children }: { children: ReactNode }) {
  return <AIContext.Provider value={mock}>{children}</AIContext.Provider>
}
export const useAI = () => useContext(AIContext)
