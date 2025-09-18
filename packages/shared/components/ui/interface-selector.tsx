import React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

interface InterfaceSelectorProps {
  currentInterface: 'web20' | 'web30'
  className?: string
}

const INTERFACE_OPTIONS = [
  { 
    id: 'web20', 
    name: 'Modern Dashboard',
    description: 'Feature-rich interface with widgets and customization',
    path: '/'
  },
  { 
    id: 'web30', 
    name: 'Clinical View',
    description: 'Streamlined interface focused on clinical workflows',
    path: '/web30/dashboard'
  }
] as const

export function InterfaceSelector({ currentInterface, className }: InterfaceSelectorProps) {
  const currentOption = INTERFACE_OPTIONS.find(opt => opt.id === currentInterface)
  
  const handleInterfaceSwitch = (targetInterface: 'web20' | 'web30') => {
    if (targetInterface === currentInterface) return
    
    const targetOption = INTERFACE_OPTIONS.find(opt => opt.id === targetInterface)
    if (!targetOption) return
    
    // Get current URL and update path
    const url = new URL(window.location.href)
    url.pathname = targetOption.path
    
    // Navigate to new interface
    window.location.href = url.toString()
  }
  
  return (
    <div className={cn("relative", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="min-w-[200px] justify-between">
            <span className="truncate">{currentOption?.name}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[300px]">
          {INTERFACE_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.id}
              onClick={() => handleInterfaceSwitch(option.id)}
              className={cn(
                "flex flex-col items-start py-3",
                option.id === currentInterface && "bg-accent"
              )}
            >
              <div className="font-medium">{option.name}</div>
              <div className="text-sm text-muted-foreground">
                {option.description}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}