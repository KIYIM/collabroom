export const ROOM_ID = 'room_7f3c9a'
export const STORAGE_KEY = `collabroom:${ROOM_ID}:workspace`
export const CHANNEL_NAME = `collabroom:${ROOM_ID}`

export type Language = 'JavaScript' | 'TypeScript' | 'Python' | 'C++' | 'JSON' | 'Markdown' | 'Plain Text'

export type WorkspaceFile = {
  name: string
  content: string
  folder: 'src' | 'root'
}

export type WorkspaceState = {
  files: WorkspaceFile[]
  activeFile: string
}

export type CursorPos = {
  line: number
  column: number
  offset: number
}

export type PeerPresence = {
  clientId: string
  tag: string
  color: string
  file: string | null
  cursor: CursorPos | null
  updatedAt: number
}

export type RoomEvent =
  | {
      type: 'hello'
      clientId: string
      tag: string
      color: string
    }
  | {
      type: 'bye'
      clientId: string
    }
  | {
      type: 'code'
      clientId: string
      file: string
      content: string
      revision: number
    }
  | {
      type: 'cursor'
      clientId: string
      tag: string
      color: string
      file: string
      cursor: CursorPos
    }
  | {
      type: 'files'
      clientId: string
      files: WorkspaceFile[]
      activeFile: string
    }
  | {
      type: 'active'
      clientId: string
      activeFile: string
    }
  | {
      type: 'snapshot'
      files: WorkspaceFile[]
      activeFile: string
      peers: PeerPresence[]
    }

export const AVATAR_PALETTE = [
  { tag: 'YO', color: 'bg-cyan-300', hex: '#67e8f9' },
  { tag: 'MC', color: 'bg-fuchsia-300', hex: '#f0abfc' },
  { tag: 'JL', color: 'bg-amber-300', hex: '#fcd34d' },
  { tag: 'AK', color: 'bg-emerald-300', hex: '#6ee7b7' },
  { tag: 'RS', color: 'bg-rose-300', hex: '#fda4af' },
  { tag: 'NB', color: 'bg-sky-300', hex: '#7dd3fc' },
] as const

export const DEFAULT_FILES: WorkspaceFile[] = [
  {
    name: 'index.ts',
    folder: 'src',
    content: `export function greet(name: string) {
  return \`Hello, \${name}!\`;
}

console.log(greet("CollabRoom"));
`,
  },
  {
    name: 'server.ts',
    folder: 'src',
    content: `console.log("Hello from the collaboration room");
console.log(2 + 2);
`,
  },
  {
    name: 'utils.ts',
    folder: 'src',
    content: `export function sum(a: number, b: number) {
  return a + b;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
`,
  },
  {
    name: 'package.json',
    folder: 'root',
    content: `{
  "name": "collabroom-workspace",
  "version": "0.1.0",
  "private": true
}
`,
  },
  {
    name: 'README.md',
    folder: 'root',
    content: `# CollabRoom Workspace

Open multiple tabs to collaborate in real time.
`,
  },
]

export function detectLanguage(filename: string): Language {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'TypeScript'
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs')) return 'JavaScript'
  if (lower.endsWith('.py')) return 'Python'
  if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx') || lower.endsWith('.hpp')) {
    return 'C++'
  }
  if (lower.endsWith('.json')) return 'JSON'
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'Markdown'
  return 'Plain Text'
}

export function languageForRunner(language: Language): string {
  if (language === 'JSON' || language === 'Markdown' || language === 'Plain Text') {
    return 'JavaScript'
  }
  return language
}

export function offsetToCursor(text: string, offset: number): CursorPos {
  const safe = Math.max(0, Math.min(offset, text.length))
  const before = text.slice(0, safe)
  const lines = before.split('\n')
  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    offset: safe,
  }
}

export function createClientId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function pickAvatar(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

export function loadWorkspace(): WorkspaceState {
  if (typeof window === 'undefined') {
    return { files: DEFAULT_FILES, activeFile: 'server.ts' }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { files: DEFAULT_FILES, activeFile: 'server.ts' }
    const parsed = JSON.parse(raw) as WorkspaceState
    if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
      return { files: DEFAULT_FILES, activeFile: 'server.ts' }
    }
    const activeFile = parsed.files.some((file) => file.name === parsed.activeFile)
      ? parsed.activeFile
      : parsed.files[0].name
    return { files: parsed.files, activeFile }
  } catch {
    return { files: DEFAULT_FILES, activeFile: 'server.ts' }
  }
}

export function saveWorkspace(state: WorkspaceState) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function uniqueFileName(existing: string[], desired: string) {
  if (!existing.includes(desired)) return desired
  const dot = desired.lastIndexOf('.')
  const base = dot > 0 ? desired.slice(0, dot) : desired
  const ext = dot > 0 ? desired.slice(dot) : ''
  let i = 2
  while (existing.includes(`${base}-${i}${ext}`)) i += 1
  return `${base}-${i}${ext}`
}
