'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface CTChannelPairPickerProps {
  channels: string[]
  onPairAdded: (channel1: string, channel2: string) => void
  disabled?: boolean
}

export function CTChannelPairPicker({ channels, onPairAdded, disabled }: CTChannelPairPickerProps) {
  const [selectedChannels, setSelectedChannels] = useState<[string | null, string | null]>([null, null])

  const handleChannelClick = (channel: string) => {
    if (disabled) return

    // If this channel is already selected, deselect it
    if (selectedChannels[0] === channel) {
      setSelectedChannels([null, null])
      return
    }
    if (selectedChannels[1] === channel) {
      setSelectedChannels([selectedChannels[0], null])
      return
    }

    // Add to first empty slot
    if (selectedChannels[0] === null) {
      setSelectedChannels([channel, null])
    } else if (selectedChannels[1] === null) {
      // Second channel selected - create pair
      const ch1 = selectedChannels[0]
      const ch2 = channel
      onPairAdded(ch1, ch2)
      setSelectedChannels([null, null]) // Reset selection
    }
  }

  const getChannelState = (channel: string): 'idle' | 'first' | 'second' => {
    if (selectedChannels[0] === channel) return 'first'
    if (selectedChannels[1] === channel) return 'second'
    return 'idle'
  }

  return (
    <div className="space-y-2">
      {/* Selection status */}
      <div className="flex items-center gap-2 text-sm">
        {selectedChannels[0] && (
          <Badge variant="default" className="bg-blue-600">
            1st: {selectedChannels[0]}
          </Badge>
        )}
        {selectedChannels[1] && (
          <Badge variant="default" className="bg-green-600">
            2nd: {selectedChannels[1]}
          </Badge>
        )}
        {selectedChannels[0] === null && (
          <span className="text-muted-foreground">Select first channel...</span>
        )}
      </div>

      {/* Channel grid */}
      <div className="grid grid-cols-6 gap-2 max-h-48 overflow-y-auto p-2 border rounded-md">
        {channels.map((channel) => {
          const state = getChannelState(channel)
          return (
            <Badge
              key={channel}
              variant={state === 'idle' ? 'outline' : 'default'}
              className={`cursor-pointer text-center justify-center transition-colors ${
                state === 'first'
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : state === 'second'
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'hover:bg-accent'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={() => handleChannelClick(channel)}
            >
              {channel}
            </Badge>
          )
        })}
      </div>

      {/* Instructions */}
      <p className="text-xs text-muted-foreground">
        {selectedChannels[0]
          ? `Click another channel to create pair: ${selectedChannels[0]} ⟷ ?`
          : 'Click any channel to start selecting a pair'
        }
      </p>

      {/* Reset button */}
      {selectedChannels[0] !== null && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedChannels([null, null])}
          disabled={disabled}
          className="w-full"
        >
          Cancel Selection
        </Button>
      )}
    </div>
  )
}
