'use client'

import { useAppStore } from '@/store/appStore'
import { navigationConfig, PrimaryNavTab } from '@/types/navigation'
import { Home, BarChart3, Brain, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const iconMap = {
  Home,
  BarChart3,
  Brain,
  Settings,
}

export function PrimaryNavigation() {
  const primaryNav = useAppStore(state => state.ui.primaryNav)
  const setPrimaryNav = useAppStore(state => state.setPrimaryNav)

  const handleNavClick = (tab: PrimaryNavTab) => {
    setPrimaryNav(tab)
  }

  return (
    <div className="border-b bg-background">
      <div className="flex items-center px-4 py-2">
        <div className="flex items-center space-x-1">
          {Object.values(navigationConfig).map((nav) => {
            const Icon = iconMap[nav.icon as keyof typeof iconMap]
            const isActive = primaryNav === nav.id

            return (
              <button
                key={nav.id}
                onClick={() => handleNavClick(nav.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  isActive && 'bg-accent text-accent-foreground'
                )}
                title={nav.description}
              >
                <Icon className="h-4 w-4" />
                {nav.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
