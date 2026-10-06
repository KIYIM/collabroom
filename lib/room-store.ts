import type { PeerPresence, RoomEvent, WorkspaceFile } from '@/lib/workspace'

type RoomClient = {
  id: string
  send: (event: RoomEvent) => void
}

type RoomState = {
  files: WorkspaceFile[] | null
  activeFile: string | null
  peers: Map<string, PeerPresence>
  clients: Map<string, RoomClient>
}

const globalForRooms = globalThis as typeof globalThis & {
  __collabRooms?: Map<string, RoomState>
}

function rooms() {
  if (!globalForRooms.__collabRooms) {
    globalForRooms.__collabRooms = new Map()
  }
  return globalForRooms.__collabRooms
}

function getOrCreateRoom(roomId: string): RoomState {
  const map = rooms()
  let room = map.get(roomId)
  if (!room) {
    room = {
      files: null,
      activeFile: null,
      peers: new Map(),
      clients: new Map(),
    }
    map.set(roomId, room)
  }
  return room
}

export function subscribe(roomId: string, client: RoomClient) {
  const room = getOrCreateRoom(roomId)
  room.clients.set(client.id, client)

  const snapshot: RoomEvent = {
    type: 'snapshot',
    files: room.files ?? [],
    activeFile: room.activeFile ?? 'server.ts',
    peers: Array.from(room.peers.values()),
  }
  client.send(snapshot)

  return () => {
    room.clients.delete(client.id)
    room.peers.delete(client.id)
    broadcast(roomId, { type: 'bye', clientId: client.id }, client.id)
  }
}

export function broadcast(roomId: string, event: RoomEvent, exceptClientId?: string) {
  const room = getOrCreateRoom(roomId)

  if (event.type === 'hello') {
    room.peers.set(event.clientId, {
      clientId: event.clientId,
      tag: event.tag,
      color: event.color,
      file: null,
      cursor: null,
      updatedAt: Date.now(),
    })
  }

  if (event.type === 'bye') {
    room.peers.delete(event.clientId)
  }

  if (event.type === 'cursor') {
    room.peers.set(event.clientId, {
      clientId: event.clientId,
      tag: event.tag,
      color: event.color,
      file: event.file,
      cursor: event.cursor,
      updatedAt: Date.now(),
    })
  }

  if (event.type === 'code') {
    if (room.files) {
      room.files = room.files.map((file) =>
        file.name === event.file ? { ...file, content: event.content } : file,
      )
    }
  }

  if (event.type === 'files') {
    room.files = event.files
    room.activeFile = event.activeFile
  }

  if (event.type === 'active') {
    room.activeFile = event.activeFile
  }

  for (const [id, client] of room.clients) {
    if (exceptClientId && id === exceptClientId) continue
    try {
      client.send(event)
    } catch {
      room.clients.delete(id)
    }
  }
}

export function getRoomPeerCount(roomId: string) {
  return getOrCreateRoom(roomId).clients.size
}
