'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  Download,
  FileCode2,
  Folder,
  FolderOpen,
  Pencil,
  Play,
  Plus,
  Save,
  Settings2,
  Share2,
  TerminalSquare,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { mergeRemoteFiles, useRoomSync } from '@/hooks/use-room-sync'
import {
  createClientId,
  detectLanguage,
  languageForRunner,
  loadWorkspace,
  offsetToCursor,
  pickAvatar,
  ROOM_ID,
  saveWorkspace,
  uniqueFileName,
  type Language,
  type PeerPresence,
  type RoomEvent,
  type WorkspaceFile,
  type WorkspaceState,
} from '@/lib/workspace'

type RunResponse = {
  stdout?: string
  stderr?: string
  exitCode?: number | null
  executionTimeMs?: number
  error?: string
  details?: string
}

const LINE_HEIGHT = 24
const FONT_SIZE = 13
const EDITOR_PADDING = 16

function measureCharWidth(font: string) {
  if (typeof document === 'undefined') return 7.8
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return 7.8
  context.font = font
  return context.measureText('M').width || 7.8
}

export default function Page() {
  const clientIdRef = useRef<string>('')
  if (!clientIdRef.current) clientIdRef.current = createClientId()
  const clientId = clientIdRef.current
  const avatar = useMemo(() => pickAvatar(clientId), [clientId])

  const [hydrated, setHydrated] = useState(false)
  const [workspace, setWorkspace] = useState<WorkspaceState>({
    files: [],
    activeFile: 'server.ts',
  })
  const [language, setLanguage] = useState<Language>('TypeScript')
  const [output, setOutput] = useState(['$ Ready. Click Run Code to execute.'])
  const [showOutput, setShowOutput] = useState(true)
  const [copied, setCopied] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [peers, setPeers] = useState<PeerPresence[]>([])
  const [cursor, setCursor] = useState({ line: 1, column: 1, offset: 0 })
  const [charWidth, setCharWidth] = useState(7.8)
  const [savedFlash, setSavedFlash] = useState(true)
  const [editorScroll, setEditorScroll] = useState({ top: 0, left: 0 })

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const applyingRemoteRef = useRef(false)
  const revisionRef = useRef(0)
  const workspaceRef = useRef(workspace)
  const publishRef = useRef<((event: RoomEvent) => void) | null>(null)

  useEffect(() => {
    workspaceRef.current = workspace
  }, [workspace])

  useEffect(() => {
    const loaded = loadWorkspace()
    setWorkspace(loaded)
    setLanguage(detectLanguage(loaded.activeFile))
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    saveWorkspace(workspace)
    setSavedFlash(true)
    const timer = window.setTimeout(() => setSavedFlash(false), 1200)
    return () => window.clearTimeout(timer)
  }, [workspace, hydrated])

  useEffect(() => {
    setCharWidth(measureCharWidth(`${FONT_SIZE}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`))
  }, [])

  const activeFile = useMemo(
    () => workspace.files.find((file) => file.name === workspace.activeFile) ?? null,
    [workspace],
  )
  const code = activeFile?.content ?? ''

  const handleRemoteEvent = useCallback((event: RoomEvent) => {
    if (event.type === 'snapshot') {
      if (event.files.length) {
        setWorkspace((current) => mergeRemoteFiles(current, event.files, event.activeFile))
        if (event.activeFile) setLanguage(detectLanguage(event.activeFile))
      } else {
        const latest = workspaceRef.current
        if (latest.files.length) {
          publishRef.current?.({
            type: 'files',
            clientId,
            files: latest.files,
            activeFile: latest.activeFile,
          })
        }
      }
      setPeers(event.peers.filter((peer) => peer.clientId !== clientId))
      return
    }

    if (event.type === 'hello') {
      setPeers((current) => {
        if (current.some((peer) => peer.clientId === event.clientId)) return current
        return [
          ...current,
          {
            clientId: event.clientId,
            tag: event.tag,
            color: event.color,
            file: null,
            cursor: null,
            updatedAt: Date.now(),
          },
        ]
      })
      const latest = workspaceRef.current
      if (latest.files.length) {
        publishRef.current?.({
          type: 'files',
          clientId,
          files: latest.files,
          activeFile: latest.activeFile,
        })
      }
      return
    }

    if (event.type === 'bye') {
      setPeers((current) => current.filter((peer) => peer.clientId !== event.clientId))
      return
    }

    if (event.type === 'cursor') {
      setPeers((current) => {
        const next = current.filter((peer) => peer.clientId !== event.clientId)
        next.push({
          clientId: event.clientId,
          tag: event.tag,
          color: event.color,
          file: event.file,
          cursor: event.cursor,
          updatedAt: Date.now(),
        })
        return next
      })
      return
    }

    if (event.type === 'code') {
      applyingRemoteRef.current = true
      setWorkspace((current) => ({
        ...current,
        files: current.files.map((file) =>
          file.name === event.file ? { ...file, content: event.content } : file,
        ),
      }))
      queueMicrotask(() => {
        applyingRemoteRef.current = false
      })
      return
    }

    if (event.type === 'files') {
      applyingRemoteRef.current = true
      setWorkspace({ files: event.files, activeFile: event.activeFile })
      setLanguage(detectLanguage(event.activeFile))
      queueMicrotask(() => {
        applyingRemoteRef.current = false
      })
      return
    }

    if (event.type === 'active') {
      setWorkspace((current) => {
        if (!current.files.some((file) => file.name === event.activeFile)) return current
        return { ...current, activeFile: event.activeFile }
      })
      setLanguage(detectLanguage(event.activeFile))
    }
  }, [clientId])

  const { connected, publish } = useRoomSync({
    clientId,
    tag: avatar.tag,
    color: avatar.color,
    enabled: hydrated,
    onEvent: handleRemoteEvent,
  })

  useEffect(() => {
    publishRef.current = publish
  }, [publish])

  const broadcastFiles = useCallback(
    (next: WorkspaceState) => {
      publish({
        type: 'files',
        clientId,
        files: next.files,
        activeFile: next.activeFile,
      })
    },
    [clientId, publish],
  )

  const updateCode = (nextCode: string) => {
    const fileName = workspace.activeFile
    setWorkspace((current) => ({
      ...current,
      files: current.files.map((file) =>
        file.name === fileName ? { ...file, content: nextCode } : file,
      ),
    }))

    if (applyingRemoteRef.current) return

    revisionRef.current += 1
    publish({
      type: 'code',
      clientId,
      file: fileName,
      content: nextCode,
      revision: revisionRef.current,
    })
  }

  const openFile = (name: string) => {
    setWorkspace((current) => ({ ...current, activeFile: name }))
    setLanguage(detectLanguage(name))
    publish({ type: 'active', clientId, activeFile: name })
    window.requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const addFile = () => {
    const desired = window.prompt('New file name', 'untitled.ts')
    if (!desired) return
    const name = uniqueFileName(
      workspace.files.map((file) => file.name),
      desired.trim(),
    )
    if (!name) return
    const folder = name.endsWith('.ts') || name.endsWith('.js') || name.endsWith('.py') || name.endsWith('.cpp')
      ? 'src'
      : 'root'
    const next: WorkspaceState = {
      files: [...workspace.files, { name, content: '', folder }],
      activeFile: name,
    }
    setWorkspace(next)
    setLanguage(detectLanguage(name))
    broadcastFiles(next)
  }

  const renameFile = (currentName: string) => {
    const desired = window.prompt('Rename file', currentName)
    if (!desired) return
    const trimmed = desired.trim()
    if (!trimmed || trimmed === currentName) return
    const name = uniqueFileName(
      workspace.files.filter((file) => file.name !== currentName).map((file) => file.name),
      trimmed,
    )
    const next: WorkspaceState = {
      files: workspace.files.map((file) => (file.name === currentName ? { ...file, name } : file)),
      activeFile: workspace.activeFile === currentName ? name : workspace.activeFile,
    }
    setWorkspace(next)
    if (next.activeFile === name) setLanguage(detectLanguage(name))
    broadcastFiles(next)
  }

  const emitCursor = (offset: number, text = code) => {
    const next = offsetToCursor(text, offset)
    setCursor(next)
    publish({
      type: 'cursor',
      clientId,
      tag: avatar.tag,
      color: avatar.color,
      file: workspace.activeFile,
      cursor: next,
    })
  }

  const copyRoom = () => {
    void navigator.clipboard?.writeText(ROOM_ID)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const download = () => {
    const name = workspace.activeFile || 'untitled.txt'
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  }

  const snapshot = () => {
    saveWorkspace(workspace)
    const stamp = new Date().toLocaleTimeString()
    setOutput([`$ snapshot save`, `Snapshot saved at ${stamp}`])
    broadcastFiles(workspace)
  }

  const runCode = async () => {
    if (isRunning) return
    const runnerLanguage = languageForRunner(language)

    setShowOutput(true)
    setIsRunning(true)
    setOutput([`$ room run ${workspace.activeFile}`, `Running ${runnerLanguage}...`])

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), 20_000)

    try {
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ language: runnerLanguage, code }),
      })

      let data: RunResponse = {}
      try {
        data = (await response.json()) as RunResponse
      } catch {
        setOutput([`$ room run ${workspace.activeFile}`, '✗ Failed to parse server response.'])
        return
      }

      if (!response.ok || data.error) {
        const lines = [
          `$ room run ${workspace.activeFile}`,
          `✗ ${data.error ?? `Request failed (${response.status})`}`,
        ]
        if (data.details) lines.push(data.details)
        if (data.stderr) lines.push(data.stderr.trimEnd())
        if (typeof data.executionTimeMs === 'number') {
          lines.push(`Execution time: ${data.executionTimeMs} ms`)
        }
        setOutput(lines)
        return
      }

      const lines = [`$ room run ${workspace.activeFile}`]
      const stdout = (data.stdout ?? '').trimEnd()
      const stderr = (data.stderr ?? '').trimEnd()

      if (stdout) lines.push(...stdout.split('\n'))
      if (stderr) lines.push(...stderr.split('\n').map((line) => (line ? `stderr: ${line}` : 'stderr:')))
      if (!stdout && !stderr) lines.push('(no output)')

      const exitCode = data.exitCode ?? 0
      lines.push(
        exitCode === 0
          ? `✓ Process finished with exit code ${exitCode}`
          : `✗ Process finished with exit code ${exitCode}`,
      )
      if (typeof data.executionTimeMs === 'number') {
        lines.push(`Execution time: ${data.executionTimeMs} ms`)
      }
      setOutput(lines)
    } catch (error) {
      const timedOut =
        error instanceof DOMException
          ? error.name === 'AbortError'
          : error instanceof Error && error.name === 'AbortError'
      setOutput([
        `$ room run ${workspace.activeFile}`,
        timedOut
          ? '✗ Request timed out. The execution engine took too long to respond.'
          : '✗ Network error. Could not reach /api/run. Check your connection and try again.',
      ])
    } finally {
      window.clearTimeout(timeoutId)
      setIsRunning(false)
    }
  }

  const srcFiles = workspace.files.filter((file) => file.folder === 'src')
  const rootFiles = workspace.files.filter((file) => file.folder === 'root')
  const visiblePeers = peers.filter((peer) => Date.now() - peer.updatedAt < 30_000)
  const remoteCursors = visiblePeers.filter(
    (peer) => peer.file === workspace.activeFile && peer.cursor,
  )

  const lineCount = Math.max(1, code.split('\n').length)

  if (!hydrated) {
    return (
      <main className="grid h-screen place-items-center bg-[#0b1020] text-[#8b9abb]">
        Loading workspace…
      </main>
    )
  }

  return (
    <main className="flex h-screen min-h-[680px] flex-col overflow-hidden bg-[#0b1020] text-[#d7e1f2]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-[#26314b] bg-[#10172a] px-4">
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2 text-sm font-bold tracking-[0.18em] text-cyan-300">
            <span className="grid size-7 place-items-center rounded border border-cyan-300/50 bg-cyan-300/10 text-xs">
              &lt;/&gt;
            </span>
            COLLABROOM
          </div>
          <div className="h-5 w-px bg-[#303b57]" />
          <span className="text-xs text-[#8b9abb]">main</span>
          <span
            className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
              connected
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
                : 'border-amber-400/20 bg-amber-400/10 text-amber-300'
            }`}
          >
            {connected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
            {connected ? 'Connected' : 'Reconnecting'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex -space-x-2">
            <span
              className={`grid size-7 place-items-center rounded-full border-2 border-[#10172a] ${avatar.color} text-[10px] font-bold text-[#11182a]`}
              title="You"
            >
              {avatar.tag}
            </span>
            {visiblePeers.slice(0, 4).map((peer) => (
              <span
                key={peer.clientId}
                className={`grid size-7 place-items-center rounded-full border-2 border-[#10172a] ${peer.color} text-[10px] font-bold text-[#11182a]`}
              >
                {peer.tag}
              </span>
            ))}
          </div>
          <button
            onClick={copyRoom}
            className="flex items-center gap-2 rounded border border-[#33415f] px-3 py-1.5 text-xs text-[#b3c1da] hover:border-cyan-300/50"
          >
            <Share2 className="size-3.5" />
            {copied ? 'Copied' : 'Invite'}
          </button>
          <Settings2 className="size-4 text-[#8b9abb]" />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-[#26314b] bg-[#0e1527]">
          <div className="flex items-center justify-between border-b border-[#26314b] px-4 py-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#71809d]">
              Explorer
            </span>
            <div className="flex gap-2 text-[#71809d]">
              <button
                type="button"
                onClick={addFile}
                className="rounded p-0.5 hover:bg-[#1a243c] hover:text-cyan-300"
                aria-label="Add file"
                title="Add file"
              >
                <Plus className="size-4" />
              </button>
              <FileCode2 className="size-4" />
              <Folder className="size-4" />
            </div>
          </div>

          <div className="flex-1 overflow-auto p-3 text-sm">
            <div className="flex items-center gap-2 py-2 text-[#bdc9df]">
              <FolderOpen className="size-4 text-cyan-300" /> workspace
            </div>
            <div className="ml-3 border-l border-[#293653] pl-3">
              <div className="flex items-center gap-2 py-2 text-[#aebbd3]">
                <Folder className="size-4 text-amber-300" /> src
              </div>
              {srcFiles.map((file) => (
                <FileRow
                  key={file.name}
                  file={file}
                  active={workspace.activeFile === file.name}
                  onOpen={() => openFile(file.name)}
                  onRename={() => renameFile(file.name)}
                />
              ))}
              {rootFiles.map((file) => (
                <FileRow
                  key={file.name}
                  file={file}
                  active={workspace.activeFile === file.name}
                  onOpen={() => openFile(file.name)}
                  onRename={() => renameFile(file.name)}
                />
              ))}
            </div>
          </div>

          <div className="border-t border-[#26314b] p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#71809d]">
                Active now
              </span>
              <Users className="size-3.5 text-[#71809d]" />
            </div>
            <div className="flex flex-wrap gap-2">
              <span
                className={`grid size-8 place-items-center rounded-full ${avatar.color} text-[10px] font-bold text-[#11182a]`}
              >
                {avatar.tag}
              </span>
              {visiblePeers.map((peer) => (
                <span
                  key={peer.clientId}
                  className={`grid size-8 place-items-center rounded-full ${peer.color} text-[10px] font-bold text-[#11182a]`}
                  title={peer.file ? `Editing ${peer.file}` : 'Online'}
                >
                  {peer.tag}
                </span>
              ))}
            </div>
            <div className="mt-4 rounded border border-[#293653] bg-[#111a2f] p-3">
              <div className="mb-2 text-xs text-[#c2cde1]">Room ID</div>
              <div className="flex items-center justify-between">
                <code className="text-[11px] text-cyan-300">{ROOM_ID}</code>
                <button onClick={copyRoom} aria-label="Copy Room ID">
                  <Copy className="size-3.5 text-[#71809d]" />
                </button>
              </div>
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#26314b] bg-[#10172a] px-4">
            <div className="flex items-center gap-2 border-b-2 border-cyan-300 px-2 py-3 text-xs text-cyan-100">
              <FileCode2 className="size-3.5 text-cyan-300" />
              {workspace.activeFile}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as Language)}
                className="rounded border border-[#33415f] bg-[#151f35] px-2 py-1.5 text-xs text-[#c2cde1]"
              >
                <option>JavaScript</option>
                <option>TypeScript</option>
                <option>Python</option>
                <option>C++</option>
                <option>JSON</option>
                <option>Markdown</option>
                <option>Plain Text</option>
              </select>
              <button
                onClick={download}
                className="flex items-center gap-2 rounded border border-[#33415f] px-2 py-1.5 text-xs text-[#aebbd3]"
              >
                <Download className="size-3.5" /> Download
              </button>
              <button
                onClick={snapshot}
                className="flex items-center gap-2 rounded border border-[#33415f] px-2 py-1.5 text-xs text-[#aebbd3]"
              >
                <Save className="size-3.5" /> Snapshot
              </button>
              <button
                onClick={runCode}
                disabled={isRunning}
                className="flex items-center gap-2 rounded bg-cyan-300 px-3 py-1.5 text-xs font-bold text-[#0b1020] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Play className="size-3.5 fill-current" />
                {isRunning ? 'Running…' : 'Run Code'}
              </button>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <div className="w-12 shrink-0 overflow-hidden border-r border-[#1d2942] bg-[#0d1425] py-4 text-right font-mono text-xs leading-6 text-[#53627f]">
              <div style={{ transform: `translateY(-${editorScroll.top}px)` }}>
                {Array.from({ length: lineCount }, (_, index) => (
                  <div key={index} className="pr-3">
                    {index + 1}
                  </div>
                ))}
              </div>
            </div>

            <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
              <textarea
                ref={textareaRef}
                value={code}
                onChange={(event) => {
                  updateCode(event.target.value)
                  emitCursor(event.target.selectionStart, event.target.value)
                }}
                onSelect={(event) => emitCursor(event.currentTarget.selectionStart)}
                onKeyUp={(event) => emitCursor(event.currentTarget.selectionStart)}
                onClick={(event) => emitCursor(event.currentTarget.selectionStart)}
                onScroll={(event) => {
                  setEditorScroll({
                    top: event.currentTarget.scrollTop,
                    left: event.currentTarget.scrollLeft,
                  })
                }}
                spellCheck={false}
                aria-label="Code editor"
                className="absolute inset-0 resize-none overflow-auto bg-[#0b1020] p-4 font-mono text-[13px] leading-6 text-[#c8d5eb] outline-none"
              />

              {remoteCursors.map((peer) => {
                if (!peer.cursor) return null
                const top =
                  EDITOR_PADDING + (peer.cursor.line - 1) * LINE_HEIGHT - editorScroll.top
                const left =
                  EDITOR_PADDING + (peer.cursor.column - 1) * charWidth - editorScroll.left
                const hex = peer.color.includes('cyan')
                  ? '#67e8f9'
                  : peer.color.includes('fuchsia')
                    ? '#f0abfc'
                    : peer.color.includes('amber')
                      ? '#fcd34d'
                      : peer.color.includes('emerald')
                        ? '#6ee7b7'
                        : peer.color.includes('rose')
                          ? '#fda4af'
                          : '#7dd3fc'

                if (top < -24 || left < -40) return null

                return (
                  <div
                    key={peer.clientId}
                    className="pointer-events-none absolute z-10"
                    style={{ top, left }}
                  >
                    <div className="h-5 w-0.5" style={{ backgroundColor: hex }} />
                    <div
                      className="absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold text-[#11182a]"
                      style={{ backgroundColor: hex }}
                    >
                      {peer.tag}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {showOutput ? (
            <div className="h-44 shrink-0 border-t border-[#26314b] bg-[#0a0f1c]">
              <div className="flex h-10 items-center justify-between border-b border-[#1d2942] px-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#b9c6dd]">
                  <TerminalSquare className="size-3.5 text-cyan-300" /> Output
                </div>
                <button onClick={() => setShowOutput(false)} className="text-xs text-[#71809d]">
                  Hide
                </button>
              </div>
              <div className="h-[calc(100%-2.5rem)] overflow-auto p-4 font-mono text-xs leading-6 text-[#8fa2c1]">
                {output.map((line, index) => (
                  <div
                    key={index}
                    className={
                      line.startsWith('✓')
                        ? 'text-emerald-300'
                        : line.startsWith('✗') || line.startsWith('stderr:')
                          ? 'text-rose-300'
                          : line.startsWith('$')
                            ? 'text-cyan-300'
                            : ''
                    }
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowOutput(true)}
              className="flex h-9 items-center gap-2 border-t border-[#26314b] px-4 text-xs text-[#8b9abb]"
            >
              <TerminalSquare className="size-3.5" /> Show Output
            </button>
          )}
        </section>
      </div>

      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-[#26314b] bg-[#111a2f] px-3 text-[10px] text-[#71809d]">
        <span>
          Ln {cursor.line}, Col {cursor.column}　 UTF-8　 LF　{' '}
          <b className="text-cyan-300">{language}</b>
        </span>
        <span className={savedFlash ? 'text-emerald-300' : 'text-[#71809d]'}>
          ● {savedFlash ? 'Saved just now' : 'Autosaved'}
        </span>
      </footer>
    </main>
  )
}

function FileRow({
  file,
  active,
  onOpen,
  onRename,
}: {
  file: WorkspaceFile
  active: boolean
  onOpen: () => void
  onRename: () => void
}) {
  return (
    <div
      className={`group flex w-full items-center gap-1 rounded px-1 ${
        active ? 'bg-cyan-300/10 text-cyan-200' : 'text-[#8290ac]'
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 px-1 py-2 text-left text-xs"
      >
        <FileCode2 className="size-3.5 shrink-0" />
        <span className="truncate">{file.name}</span>
      </button>
      <button
        type="button"
        onClick={onRename}
        className="rounded p-1 opacity-0 hover:bg-[#1a243c] group-hover:opacity-100"
        aria-label={`Rename ${file.name}`}
        title="Rename"
      >
        <Pencil className="size-3" />
      </button>
    </div>
  )
}
