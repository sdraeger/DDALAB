'use client'

import { useMemo } from 'react'
import { EDFFileInfo } from '@/types/api'
import { useAppStore } from '@/store/appStore'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
  FileText,
  Clock,
  Activity,
  Layers,
  HardDrive,
  Calendar,
  Hash,
  Zap,
} from 'lucide-react'

interface FileInfoCardProps {
  fileInfo: EDFFileInfo
}

export function FileInfoCard({ fileInfo }: FileInfoCardProps) {
  // Get file annotations object from state (stable reference)
  const fileAnnotations = useAppStore(state => state.annotations.timeSeries[fileInfo.file_path])

  // Memoize annotation counts to prevent infinite loops
  const annotations = useMemo(() => {
    if (!fileAnnotations) return { globalCount: 0, channelCount: 0 }

    const globalCount = fileAnnotations.globalAnnotations?.length || 0
    const channelCount = Object.values(fileAnnotations.channelAnnotations || {})
      .reduce((sum, anns) => sum + anns.length, 0)

    return { globalCount, channelCount }
  }, [fileAnnotations])

  const totalAnnotationCount = annotations.globalCount + annotations.channelCount
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`
    }
    return `${secs}s`
  }

  const formatNumber = (num: number): string => {
    return num.toLocaleString()
  }

  const formatDateTime = (dateStr: string): string => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleString()
    } catch {
      return dateStr
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          File Information
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* File Basic Info */}
        <div className="space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span className="font-medium">File Name</span>
            </div>
            <span className="text-sm font-mono text-right max-w-md truncate" title={fileInfo.file_name}>
              {fileInfo.file_name}
            </span>
          </div>

          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <HardDrive className="h-4 w-4" />
              <span className="font-medium">File Size</span>
            </div>
            <span className="text-sm">{formatFileSize(fileInfo.file_size)}</span>
          </div>

          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span className="font-medium">File Path</span>
            </div>
            <span className="text-sm font-mono text-right max-w-md truncate" title={fileInfo.file_path}>
              {fileInfo.file_path}
            </span>
          </div>
        </div>

        <Separator />

        {/* Recording Info */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span className="font-medium">Duration</span>
            </div>
            <span className="text-sm font-medium">{formatDuration(fileInfo.duration)}</span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="h-4 w-4" />
              <span className="font-medium">Sample Rate</span>
            </div>
            <span className="text-sm">{fileInfo.sample_rate.toFixed(2)} Hz</span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Hash className="h-4 w-4" />
              <span className="font-medium">Total Samples</span>
            </div>
            <span className="text-sm font-mono">{formatNumber(fileInfo.total_samples)}</span>
          </div>
        </div>

        <Separator />

        {/* Channel Info */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Layers className="h-4 w-4" />
              <span className="font-medium">Channels</span>
            </div>
            <Badge variant="secondary">{fileInfo.channels.length} channels</Badge>
          </div>

          <div className="max-h-40 overflow-y-auto border rounded-md p-3 bg-muted/30">
            <div className="flex flex-wrap gap-2">
              {fileInfo.channels.map((channel, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {channel}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <Separator />

        {/* Time Range */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span className="font-medium">Start Time</span>
            </div>
            <span className="text-sm">{formatDateTime(fileInfo.start_time)}</span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span className="font-medium">End Time</span>
            </div>
            <span className="text-sm">{formatDateTime(fileInfo.end_time)}</span>
          </div>
        </div>

        {/* Annotations Count */}
        <Separator />
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Zap className="h-4 w-4" />
              <span className="font-medium">Annotations</span>
            </div>
            <Badge variant={totalAnnotationCount > 0 ? 'default' : 'secondary'}>
              {totalAnnotationCount} annotation{totalAnnotationCount !== 1 ? 's' : ''}
            </Badge>
          </div>
          {totalAnnotationCount > 0 && (
            <div className="text-xs text-muted-foreground pl-6">
              {annotations.globalCount > 0 && (
                <span>{annotations.globalCount} global</span>
              )}
              {annotations.globalCount > 0 && annotations.channelCount > 0 && <span>, </span>}
              {annotations.channelCount > 0 && (
                <span>{annotations.channelCount} channel-specific</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
