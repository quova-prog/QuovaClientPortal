import { createContext, useContext, useState, useEffect } from 'react'
import type { RiskModule } from '@/lib/tierService'
import { useAuth } from '@/hooks/useAuth'

interface ModuleContextType {
  currentModule: RiskModule
  setCurrentModule: (m: RiskModule) => void
  availableModules: RiskModule[]
}

const ModuleContext = createContext<ModuleContextType | undefined>(undefined)

export function ModuleProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  
  const dbModules = user?.organisation?.modules ?? ['fx']
  // For testing/MVP purposes, always ensure 'commodity' is available
  const availableModules: RiskModule[] = [...new Set([...dbModules, 'commodity'])] as RiskModule[]
  
  // Default to the first available module (usually fx)
  const [currentModule, setCurrentModuleState] = useState<RiskModule>(availableModules[0] ?? 'fx')

  // If the user's available modules change, ensure the current module is valid
  useEffect(() => {
    if (availableModules.length > 0 && !availableModules.includes(currentModule)) {
      setCurrentModuleState(availableModules[0])
    }
  }, [availableModules, currentModule])

  function setCurrentModule(module: RiskModule) {
    if (availableModules.includes(module)) {
      setCurrentModuleState(module)
    }
  }

  return (
    <ModuleContext.Provider value={{ currentModule, setCurrentModule, availableModules }}>
      {children}
    </ModuleContext.Provider>
  )
}

export function useModule() {
  const context = useContext(ModuleContext)
  if (context === undefined) {
    throw new Error('useModule must be used within a ModuleProvider')
  }
  return context
}
