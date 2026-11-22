// The two network calls: an OpenAI-compatible transcription of the WAV (by
// curl, as multipart), and an optional chat completion that corrects it.

export type HttpBody = string | { base64: string }
export type HttpAnswer = { status: number; ok: boolean; text: string }

export type Deps = {
  post: (url: string, init: { method: string; headers: Record<string, string>; body: HttpBody }) => Promise<HttpAnswer>
  /** Resolves after `ms`, or rejects at once when `signal` aborts; times out a request. */
  delay: (ms: number, signal: AbortSignal) => Promise<void>
}

export class VoiceError extends Error {}

export type AsrConfig = {
  baseUrl: string
  model: string
  apiKey: string
  /** `auto`, or a language code (`zh`, `en`) passed on to the service. */
  language: string
  hotwords: string[]
  timeoutMs: number
}

export type FixConfig = {
  baseUrl: string
  model: string
  apiKey: string
  extraBody: Record<string, unknown>
  hotwords: string[]
  timeoutMs: number
}

function endpoint(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path
}

/** Races a request against the timeout; never echoes a body (some reflect the key). */
async function send(deps: Deps, url: string, init: Parameters<Deps['post']>[1], timeoutMs: number): Promise<HttpAnswer> {
  const stop = new AbortController()
  const timeout = deps.delay(timeoutMs, stop.signal).then(
    () => {
      throw new VoiceError(`timed out after ${Math.round(timeoutMs / 1000)}s`)
    },
    () => new Promise<never>(() => {}),
  )
  let res: HttpAnswer
  try {
    res = await Promise.race([deps.post(url, init), timeout])
  } catch (err) {
    if (err instanceof VoiceError) throw err
    throw new VoiceError(`request failed: ${(err as Error).message}`)
  } finally {
    stop.abort()
  }
  check(res)
  return res
}

function check(res: HttpAnswer) {
  if (res.ok) return
  const hint = res.status === 401 || res.status === 403 ? ' (check the API key)' : ''
  throw new VoiceError(res.status ? `HTTP ${res.status}${hint}` : 'no answer')
}

/**
 * The multipart upload of one file on disk (the plugin's own fetch carries
 * text bodies only): fields, then the file. Answers as a fetch would.
 */
export type Upload = (
  url: string,
  apiKey: string,
  fields: Record<string, string>,
  file: { path: string; type: string },
  timeoutMs: number,
) => Promise<HttpAnswer>

/** The transcript of a WAV file on disk, as the service returned it (not yet cleaned). */
export async function transcribe(upload: Upload, cfg: AsrConfig, wavPath: string): Promise<string> {
  if (!cfg.baseUrl || !cfg.model) throw new VoiceError('asr_base_url or asr_model is not configured')
  if (!cfg.apiKey) throw new VoiceError('no API key (set asr_api_key, or CC_VOICE_API_KEY)')
  const fields: Record<string, string> = { model: cfg.model, response_format: 'json' }
  if (cfg.language && cfg.language !== 'auto') fields.language = cfg.language
  if (cfg.hotwords.length) fields.prompt = cfg.hotwords.join(', ')
  let res: HttpAnswer
  try {
    res = await upload(endpoint(cfg.baseUrl, '/audio/transcriptions'), cfg.apiKey, fields, { path: wavPath, type: 'audio/wav' }, cfg.timeoutMs)
  } catch (err) {
    throw err instanceof VoiceError ? err : new VoiceError(`request failed: ${(err as Error).message}`)
  }
  check(res)
  let data: any
  try {
    data = JSON.parse(res.text)
  } catch {
    // Some services answer plain text despite response_format=json.
    return res.text
  }
  if (typeof data?.text !== 'string') throw new VoiceError('answer has no text')
  return data.text
}

/**
 * curl's argv for an Upload: the key goes in on standard input (`-H @-`),
 * never on the command line; the status code is printed on the last line.
 */
export function curlArgv(url: string, fields: Record<string, string>, file: { path: string; type: string }, timeoutMs: number): string[] {
  const argv = ['curl', '-sS', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-H', '@-']
  for (const [k, v] of Object.entries(fields)) argv.push('--form-string', `${k}=${v}`)
  argv.push('-F', `file=@${file.path};type=${file.type}`, '-w', '\n%{http_code}', url)
  return argv
}

/** curl's output split into the body and the status line curlArgv asks for. */
export function curlAnswer(stdout: string): HttpAnswer {
  const cut = stdout.lastIndexOf('\n')
  const status = Number(stdout.slice(cut + 1).trim())
  const text = cut >= 0 ? stdout.slice(0, cut) : ''
  return { status, ok: status >= 200 && status < 300, text }
}

export function fixPrompt(hotwords: string[]): string {
  return [
    'You correct speech-recognition transcripts dictated by a programmer to a coding assistant.',
    'Fix misheard technical terms, identifiers, library and command names, and punctuation.',
    'Keep the language, wording and meaning; do not translate, answer, explain or add anything.',
    'Write code identifiers in their usual spelling (useEffect, git rebase, package.json).',
    hotwords.length ? `Terms the speaker often uses: ${hotwords.join(', ')}.` : '',
    'Reply with the corrected transcript only.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** The transcript corrected by a chat model. */
export async function fixTranscript(deps: Deps, cfg: FixConfig, text: string): Promise<string> {
  if (!cfg.baseUrl || !cfg.model) throw new VoiceError('fix_base_url or fix_model is not configured')
  if (!cfg.apiKey) throw new VoiceError('no API key for the fix step (fix_api_key, CC_VOICE_FIX_API_KEY or CC_TRANSLATE_API_KEY)')
  const body = {
    model: cfg.model,
    temperature: 0,
    messages: [
      { role: 'system', content: fixPrompt(cfg.hotwords) },
      { role: 'user', content: text },
    ],
    ...cfg.extraBody,
  }
  const res = await send(
    deps,
    endpoint(cfg.baseUrl, '/chat/completions'),
    { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify(body) },
    cfg.timeoutMs,
  )
  let data: any
  try {
    data = JSON.parse(res.text)
  } catch {
    throw new VoiceError('answer is not JSON')
  }
  const out = data?.choices?.[0]?.message?.content
  if (typeof out !== 'string' || out.trim() === '') throw new VoiceError('empty answer')
  return out.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '').trim()
}
