import { broadcast, subscribe } from '@/lib/room-store'
import type { RoomEvent } from '@/lib/workspace'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ roomId: string }>
}

function encodeSse(event: RoomEvent | { type: 'ping' }) {
  return `data: ${JSON.stringify(event)}\n\n`
}

export async function GET(request: Request, context: RouteContext) {
  const { roomId } = await context.params
  const url = new URL(request.url)
  const clientId = url.searchParams.get('clientId') || `anon_${Date.now()}`

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      const send = (event: RoomEvent | { type: 'ping' }) => {
        controller.enqueue(encoder.encode(encodeSse(event)))
      }

      send({ type: 'ping' })

      const unsubscribe = subscribe(roomId, {
        id: clientId,
        send: (event) => send(event),
      })

      const heartbeat = setInterval(() => {
        try {
          send({ type: 'ping' })
        } catch {
          clearInterval(heartbeat)
        }
      }, 15000)

      const abort = () => {
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // already closed
        }
      }

      request.signal.addEventListener('abort', abort)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

export async function POST(request: Request, context: RouteContext) {
  const { roomId } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = body as RoomEvent
  if (!event || typeof event !== 'object' || !('type' in event)) {
    return Response.json({ error: 'Invalid event' }, { status: 400 })
  }

  const except =
    'clientId' in event && typeof event.clientId === 'string' ? event.clientId : undefined

  broadcast(roomId, event, except)
  return Response.json({ ok: true })
}
