'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CHANNEL_NAME,
  ROOM_ID,
  type PeerPresence,
  type RoomEvent,
  type WorkspaceFile,
  type WorkspaceState,
} from '@/lib/workspace'

type UseRoomSyncOptions = {
  clientId: string
  tag: string
  color: string
  enabled?: boolean
  onEvent: (event: RoomEvent, source: 'sse' | 'broadcast') => void
}

function postToServer(event: RoomEvent) {
  void fetch(`/api/room/${ROOM_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => {
    // Network errors are non-fatal; BroadcastChannel still syncs same-browser tabs.
  })
}

export function useRoomSync({
  clientId,
  tag,
  color,
  enabled = true,
  onEvent,
}: UseRoomSyncOptions) {
  const channelRef = useRef<BroadcastChannel | null>(null)
  const onEventRef = useRef(onEvent)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  const publish = useCallback((event: RoomEvent, opts?: { localOnly?: boolean }) => {
    channelRef.current?.postMessage(event)
    if (!opts?.localOnly) {
      postToServer(event)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    const channel =
      typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null
    channelRef.current = channel

    const onMessage = (message: MessageEvent<RoomEvent>) => {
      const event = message.data
      if (!event || typeof event !== 'object') return
      if ('clientId' in event && event.clientId === clientId) return
      onEventRef.current(event, 'broadcast')
    }

    channel?.addEventListener('message', onMessage)

    const source = new EventSource(`/api/room/${ROOM_ID}?clientId=${encodeURIComponent(clientId)}`)

    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as RoomEvent | { type: 'ping' }
        if (!event || event.type === 'ping') return
        if ('clientId' in event && event.clientId === clientId) return
        onEventRef.current(event, 'sse')
      } catch {
        // ignore malformed payloads
      }
    }

    publish({ type: 'hello', clientId, tag, color })

    const onUnload = () => {
      publish({ type: 'bye', clientId })
    }
    window.addEventListener('beforeunload', onUnload)

    return () => {
      window.removeEventListener('beforeunload', onUnload)
      publish({ type: 'bye', clientId })
      source.close()
      channel?.removeEventListener('message', onMessage)
      channel?.close()
      channelRef.current = null
      setConnected(false)
    }
  }, [clientId, color, enabled, publish, tag])

  return { connected, publish }
}

export function mergeRemoteFiles(
  current: WorkspaceState,
  incoming: WorkspaceFile[],
  activeFile?: string,
): WorkspaceState {
  if (!incoming.length) return current
  const nextActive =
    activeFile && incoming.some((file) => file.name === activeFile)
      ? activeFile
      : incoming.some((file) => file.name === current.activeFile)
        ? current.activeFile
        : incoming[0].name
  return { files: incoming, activeFile: nextActive }
}
