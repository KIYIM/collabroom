import { NextRequest, NextResponse } from 'next/server'

/**
 * Execution backend.
 * Public Piston (emkc.org) became whitelist-only in Feb 2026, so we use
 * Judge0 CE (https://ce.judge0.com) by default. Set EXECUTION_ENGINE=piston
 * and optionally PISTON_URL to use a self-hosted / whitelisted Piston instance.
 */
const JUDGE0_URL =
  process.env.JUDGE0_URL ?? 'https://ce.judge0.com/submissions?base64_encoded=false&wait=true'
const PISTON_URL = process.env.PISTON_URL ?? 'https://emkc.org/api/v2/piston/execute'
const EXECUTION_ENGINE = (process.env.EXECUTION_ENGINE ?? 'judge0').toLowerCase()
const REQUEST_TIMEOUT_MS = 15_000

const JUDGE0_LANGUAGE_IDS: Record<string, number> = {
  javascript: 63,
  typescript: 74,
  python: 71,
  'c++': 54,
  cpp: 54,
}

const PISTON_LANGUAGES: Record<string, { language: string; version: string }> = {
  javascript: { language: 'javascript', version: '*' },
  typescript: { language: 'typescript', version: '*' },
  python: { language: 'python', version: '*' },
  'c++': { language: 'c++', version: '*' },
  cpp: { language: 'c++', version: '*' },
}

function normalizeLanguage(language: string) {
  return language.trim().toLowerCase()
}

type ExecutionResult = {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  executionTimeMs: number
  language: string
}

async function executeWithJudge0(
  languageKey: string,
  code: string,
  signal: AbortSignal,
): Promise<ExecutionResult> {
  const languageId = JUDGE0_LANGUAGE_IDS[languageKey]
  if (!languageId) {
    throw Object.assign(new Error(`Unsupported language: ${languageKey}`), { status: 400 })
  }

  const startedAt = Date.now()
  const response = await fetch(JUDGE0_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      source_code: code,
      language_id: languageId,
    }),
  })

  const elapsedMs = Date.now() - startedAt

  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw Object.assign(new Error(details || response.statusText || 'Judge0 request failed'), {
      status: 502,
      executionTimeMs: elapsedMs,
    })
  }

  const result = (await response.json()) as {
    stdout?: string | null
    stderr?: string | null
    compile_output?: string | null
    message?: string | null
    time?: string | null
    status?: { id?: number; description?: string }
  }

  const stdout = result.stdout ?? ''
  const stderrParts = [result.compile_output, result.stderr, result.message].filter(
    (part): part is string => Boolean(part && part.trim()),
  )
  const stderr = stderrParts.join('\n')
  const statusId = result.status?.id ?? null
  // Judge0: 3 = Accepted
  const exitCode = statusId === 3 ? 0 : statusId

  const reportedSeconds = result.time ? Number.parseFloat(result.time) : NaN
  const executionTimeMs = Number.isFinite(reportedSeconds)
    ? Math.round(reportedSeconds * 1000)
    : elapsedMs

  return {
    stdout,
    stderr,
    exitCode,
    signal: null,
    executionTimeMs,
    language: languageKey,
  }
}

async function executeWithPiston(
  languageKey: string,
  code: string,
  signal: AbortSignal,
): Promise<ExecutionResult> {
  const mapped = PISTON_LANGUAGES[languageKey]
  if (!mapped) {
    throw Object.assign(new Error(`Unsupported language: ${languageKey}`), { status: 400 })
  }

  const startedAt = Date.now()
  const response = await fetch(PISTON_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      language: mapped.language,
      version: mapped.version,
      files: [{ content: code }],
    }),
  })

  const elapsedMs = Date.now() - startedAt

  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw Object.assign(new Error(details || response.statusText || 'Piston request failed'), {
      status: 502,
      executionTimeMs: elapsedMs,
    })
  }

  const result = (await response.json()) as {
    run?: {
      stdout?: string
      stderr?: string
      code?: number | null
      signal?: string | null
    }
    compile?: {
      stdout?: string
      stderr?: string
      code?: number | null
    }
  }

  const compile = result.compile
  const run = result.run
  const stdout = [compile?.stdout, run?.stdout].filter(Boolean).join('') || ''
  const stderr = [compile?.stderr, run?.stderr].filter(Boolean).join('') || ''

  return {
    stdout,
    stderr,
    exitCode: run?.code ?? compile?.code ?? null,
    signal: run?.signal ?? null,
    executionTimeMs: elapsedMs,
    language: mapped.language,
  }
}

export async function POST(request: NextRequest) {
  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { language, code } = (body ?? {}) as {
    language?: unknown
    code?: unknown
  }

  if (typeof language !== 'string' || !language.trim()) {
    return NextResponse.json({ error: 'Missing or invalid language' }, { status: 400 })
  }

  if (typeof code !== 'string') {
    return NextResponse.json({ error: 'Missing or invalid code' }, { status: 400 })
  }

  const languageKey = normalizeLanguage(language)
  const supported =
    EXECUTION_ENGINE === 'piston'
      ? Boolean(PISTON_LANGUAGES[languageKey])
      : Boolean(JUDGE0_LANGUAGE_IDS[languageKey])

  if (!supported) {
    return NextResponse.json(
      {
        error: `Unsupported language: ${language}. Use JavaScript, TypeScript, Python, or C++.`,
      },
      { status: 400 },
    )
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const result =
      EXECUTION_ENGINE === 'piston'
        ? await executeWithPiston(languageKey, code, controller.signal)
        : await executeWithJudge0(languageKey, code, controller.signal)

    return NextResponse.json(result)
  } catch (error) {
    const isAbort =
      (error instanceof Error && error.name === 'AbortError') ||
      (typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        (error as { name: string }).name === 'AbortError')

    if (isAbort) {
      return NextResponse.json(
        {
          error: 'Execution timed out. Try a simpler program or try again.',
          executionTimeMs: REQUEST_TIMEOUT_MS,
        },
        { status: 504 },
      )
    }

    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status: number }).status)
        : 503
    const executionTimeMs =
      typeof error === 'object' && error !== null && 'executionTimeMs' in error
        ? Number((error as { executionTimeMs: number }).executionTimeMs)
        : undefined
    const message = error instanceof Error ? error.message : 'Unknown execution error'

    if (status === 400) {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json(
      {
        error:
          status === 502
            ? 'Execution engine returned an error'
            : 'Failed to reach the execution engine. Check your network and try again.',
        details: message,
        executionTimeMs,
      },
      { status: status === 502 ? 502 : 503 },
    )
  } finally {
    clearTimeout(timeoutId)
  }
}
