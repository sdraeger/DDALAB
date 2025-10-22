'use client'

import { SettingsLayout, SettingsSection } from './settings/SettingsLayout'
import { AnalysisEngineSettings } from './settings/AnalysisEngineSettings'
import { SecuritySettings } from './settings/SecuritySettings'
import { NSGSettings } from './settings/NSGSettings'
import { OpenNeuroSettings } from './settings/OpenNeuroSettings'
import { DebugSettings } from './settings/DebugSettings'
import { UpdatesSettings } from './settings/UpdatesSettings'
import { TauriService } from '@/services/tauriService'
import {
  Activity,
  Cloud,
  FileText,
  Database,
  Shield,
  Download,
} from 'lucide-react'

export function SettingsPanel() {
  const sections: SettingsSection[] = [
    {
      id: 'engine',
      label: 'Analysis Engine',
      icon: <Activity className="h-4 w-4" />,
      component: <AnalysisEngineSettings />,
    },
  ]

  // Only add Security section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: 'security',
      label: 'Security',
      icon: <Shield className="h-4 w-4" />,
      component: <SecuritySettings />,
    })
  }

  // Only add NSG section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: 'nsg',
      label: 'NSG Integration',
      icon: <Cloud className="h-4 w-4" />,
      component: <NSGSettings />,
    })
  }

  // OpenNeuro section (available in both Tauri and web)
  sections.push({
    id: 'openneuro',
    label: 'OpenNeuro',
    icon: <Database className="h-4 w-4" />,
    component: <OpenNeuroSettings />,
  })

  // Only add Debug section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: 'debug',
      label: 'Debug & Logs',
      icon: <FileText className="h-4 w-4" />,
      component: <DebugSettings />,
    })
  }

  // Only add Updates section in Tauri
  if (TauriService.isTauri()) {
    sections.push({
      id: 'updates',
      label: 'Updates',
      icon: <Download className="h-4 w-4" />,
      component: <UpdatesSettings />,
    })
  }

  return <SettingsLayout sections={sections} defaultSection="engine" />
}
