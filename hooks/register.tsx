// cc-voice: speak, and the words land in the prompt box at the cursor.
// A band Button bound to the engine's `voice:pushToTalk` action takes the
// chord the person bound to it (/dictate setup); /dictate does the same.

import type { EngineInterface, Register } from 'claude-code'

import { levels, normalize, pcmFromBytes, seconds, wav } from './audio'
import { concat, fromBase64, toBase64 } from './bytes'
import { messages, uiLang, type Messages } from './i18n'
import { ACTION, boundChord, mergeBinding } from './keybindings'
import { chooseRecorder, recorderFailure, type Recorder } from './recorder'
import { curlAnswer, curlArgv, fixTranscript, transcribe, VoiceError, type Deps, type Upload } from './service'
import { cleanTranscript, joinAtCursor, parseHotwords } from './text'

type $ = EngineInterface

const ASR_TIMEOUT_MS = 60_000
const FIX_TIMEOUT_MS = 20_000
const MIN_SECONDS = 0.3
const TEST_SECONDS = 3
const READ_CHUNK = 4 * 1024 * 1024
/** A chord: ctrl+x, then v. Rarely taken; alt+v is image paste on Windows. */
const DEFAULT_CHORD = 'ctrl+x v'

// Options, as plugin.json's userConfig handed them over.
let asrBaseUrl = ''
let asrModel = ''
let asrKey = ''
let fixEnabled = false
let fixBaseUrl = ''
let fixModel = ''
let fixKey = ''
let fixExtra: Record<string, unknown> = {}
let fixExtraError = ''
let hotwords: string[] = []
let language = 'auto'
let device = 'auto'
let maxSeconds = 120

/** The chord bound to push-to-talk, as keybindings.json held it at session start. */
let chord: string | undefined

type Mode = 'dictate' | 'test'
type State =
  | { kind: 'idle' }
  | { kind: 'recording'; mode: Mode; startedAt: number; stop: () => void; cancel: () => void }
  | { kind: 'transcribing'; step: 'asr' | 'fix' }
let state: State = { kind: 'idle' }
/** The last recording that may be transcribed again (/dictate retry). */
let lastFile: string | undefined
let now = 0

function t(): Messages {
  return messages(uiLang(language))
}

function deps($: $): Deps {
  return {
    post: (url, init) => $.http.fetch(url, init),
    delay: (ms, signal) => $.clock.sleep(ms, { signal }),
  }
}

async function asrApiKey($: $): Promise<string> {
  return asrKey || ((await $.env.get('CC_VOICE_API_KEY')) ?? '')
}

async function fixApiKey($: $): Promise<{ key: string; from: string }> {
  if (fixKey) return { key: fixKey, from: 'fix_api_key' }
  const own = await $.env.get('CC_VOICE_FIX_API_KEY')
  if (own) return { key: own, from: 'CC_VOICE_FIX_API_KEY' }
  const shared = await $.env.get('CC_TRANSLATE_API_KEY')
  if (shared) return { key: shared, from: 'CC_TRANSLATE_API_KEY' }
  return { key: '', from: '' }
}

async function keybindingsPath($: $): Promise<string> {
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${(await $.env.get('HOME')) ?? ''}/.claude`
  return `${dir.replace(/\/+$/, '')}/keybindings.json`
}

async function readOptional($: $, path: string): Promise<string | undefined> {
  try {
    return await $.fs.read(path)
  } catch {
    return undefined
  }
}

async function recordingFile($: $): Promise<string> {
  const tmp = ((await $.env.get('TMPDIR')) || '/tmp').replace(/\/+$/, '')
  const env = await $.process.hookEnv().catch(() => ({}) as Record<string, string>)
  const id = (env.CLAUDE_CODE_SESSION_ID || 'session').replace(/[^A-Za-z0-9_-]/g, '')
  return `${tmp}/cc-voice/${id}.raw`
}

/** Uploads by curl: the plugin's fetch carries text bodies only. */
function upload($: $): Upload {
  return async (url, apiKey, fields, file, timeoutMs) => {
    let r
    try {
      r = await $.process.run(curlArgv(url, fields, file, timeoutMs), {
        stdin: `Authorization: Bearer ${apiKey}\n`,
        timeoutMs: timeoutMs + 5000,
      })
    } catch (err) {
      throw new VoiceError(/ENOENT|not found/i.test((err as Error).message) ? 'curl is not installed' : (err as Error).message)
    }
    if (r.exitCode !== 0) throw new VoiceError(`curl: ${r.stderr.trim().split('\n').pop() || `exit code ${r.exitCode}`}`)
    return curlAnswer(r.stdout)
  }
}

/** Writes bytes to a file: decoded from base64 by the host's own base64. */
async function writeBytes($: $, path: string, bytes: Uint8Array) {
  const r = await $.process.run(['sh', '-c', 'base64 -d > "$0"', path], { stdin: toBase64(bytes), timeoutMs: 15000 })
  if (r.exitCode !== 0) throw new VoiceError(`could not write ${path}: ${r.stderr.trim()}`)
}

function redraw($: $) {
  $.ui.invalidate('ui.render')
}

/** The press of the chord, the band Button or /dictate: start, or stop and transcribe. */
async function toggle($: $) {
  if (state.kind === 'recording') return state.stop()
  if (state.kind === 'transcribing') return $.ui.toast(t().stillWorking)
  await record($, 'dictate')
}

/** A press returns at once: the recording and its transcription run on after it. */
function press($: $) {
  void toggle($)
}

function cancel($: $) {
  if (state.kind === 'recording') state.cancel()
}

async function record($: $, mode: Mode) {
  if (state.kind !== 'idle') return
  if (!(await asrApiKey($))) return $.ui.toast(t().noKey, { timeoutMs: 8000 })
  const file = await recordingFile($)
  let recorder: Recorder
  try {
    await $.fs.write(file, '') // makes the folder; the recorder overwrites the file
    recorder = await chooseRecorder(device, (argv) => $.process.run(argv, { timeoutMs: 5000 }))
  } catch (err) {
    return $.ui.toast(t().recorderFailed((err as Error).message))
  }
  // A cancelled or failed recording is never transcribed again.
  lastFile = undefined

  let stopped = false
  let cancelled = false
  const ended = new AbortController()
  const limit = mode === 'test' ? TEST_SECONDS : maxSeconds
  now = await $.clock.now()
  state = {
    kind: 'recording',
    mode,
    startedAt: now,
    stop: () => {
      stopped = true
      ended.abort()
    },
    cancel: () => {
      stopped = cancelled = true
      ended.abort()
    },
  }
  const stopAt = state.stop
  const timer = $.clock.after(limit * 1000, stopAt)
  const ticker = $.clock.every(1000, () => {
    void $.clock.now().then((n) => {
      now = n
      redraw($)
    })
  })
  redraw($)
  if (mode === 'test') $.ui.toast(t().testStart(TEST_SECONDS))

  let stderr = ''
  let exit: { code: number | null } | undefined
  let startError: string | undefined
  try {
    const child = $.process.spawn({ argv: recorder.argv(file) })
    const it = child[Symbol.asyncIterator]()
    ended.signal.addEventListener('abort', () => void it.return?.(undefined as never))
    while (true) {
      const r = await it.next()
      if (r.done) {
        exit = r.value ? { code: (r.value as { code: number | null }).code } : undefined
        break
      }
      if (r.value.stream === 'stderr') stderr += r.value.text
    }
  } catch (err) {
    startError = (err as Error).message
  } finally {
    timer.cancel()
    ticker.cancel()
  }

  if (cancelled) {
    state = { kind: 'idle' }
    redraw($)
    return $.ui.toast(t().cancelled)
  }
  if (!stopped || startError) {
    // The recorder ended on its own: it could not record.
    state = { kind: 'idle' }
    redraw($)
    const why = recorderFailure(startError ?? stderr, exit?.code ?? null)
    return $.ui.toast(why === 'busy' ? t().busy : why === 'missing' ? t().missing : t().recorderFailed(why), { timeoutMs: 8000 })
  }
  lastFile = file
  await transcribeFile($, file, mode, recorder.name)
}

async function readBytes($: $, path: string): Promise<Uint8Array> {
  const { size } = await $.fs.stat(path)
  const parts: Uint8Array[] = []
  for (let offset = 0; offset < size; offset += READ_CHUNK) {
    const { base64 } = (await $.fs.read(path, { as: 'bytes', offset, length: Math.min(READ_CHUNK, size - offset) })) as { base64: string }
    parts.push(fromBase64(base64))
  }
  return concat(parts)
}

async function transcribeFile($: $, file: string, mode: Mode, recorderName: string) {
  state = { kind: 'transcribing', step: 'asr' }
  redraw($)
  const m = t()
  try {
    const pcm = pcmFromBytes(await readBytes($, file))
    if (seconds(pcm) < MIN_SECONDS) return $.ui.toast(m.tooShort)
    const level = levels(pcm)
    const loud = normalize(pcm)
    const wavPath = file.replace(/\.raw$/, '') + '.wav'
    await writeBytes($, wavPath, wav(loud.pcm))
    const raw = await transcribe(
      upload($),
      { baseUrl: asrBaseUrl, model: asrModel, apiKey: await asrApiKey($), language, hotwords, timeoutMs: ASR_TIMEOUT_MS },
      wavPath,
    )
    let text = cleanTranscript(raw)

    if (mode === 'test') {
      const report = m.testReport({ recorder: recorderName, secs: seconds(pcm), ...level, gainDb: loud.gainDb, text })
      for (const line of level.peakDb < -20 ? [...report, m.quietHint] : report) $.ui.log(line)
      return
    }
    if (!text) return $.ui.toast(m.empty)

    if (fixEnabled) {
      state = { kind: 'transcribing', step: 'fix' }
      redraw($)
      try {
        const { key } = await fixApiKey($)
        text = await fixTranscript(
          deps($),
          { baseUrl: fixBaseUrl, model: fixModel, apiKey: key, extraBody: fixExtra, hotwords, timeoutMs: FIX_TIMEOUT_MS },
          text,
        )
      } catch (err) {
        $.ui.toast(m.fixFailed((err as Error).message))
      }
    }

    const box = await $.prompt.read().catch(() => ({ text: '', cursor: 0 }))
    const insert = joinAtCursor(box.text.slice(0, box.cursor), text, box.text.slice(box.cursor))
    const filled = await $.prompt.fill({ text: insert, mode: 'insert' })
    // Kept out (a dialog holds the keys, no box): the words are shown, not lost.
    if (!filled.isFilled && filled.refusal !== 'unanswered') $.ui.log(m.notFilled(text))
  } catch (err) {
    const reason = err instanceof VoiceError ? err.message : `${(err as Error).message}`
    $.ui.toast(m.failed(reason), { timeoutMs: 8000 })
  } finally {
    state = { kind: 'idle' }
    redraw($)
  }
}

async function retry($: $) {
  if (state.kind !== 'idle') return $.ui.toast(t().stillWorking)
  if (!lastFile) return $.ui.toast(t().noRecording)
  await transcribeFile($, lastFile, 'dictate', '')
}

async function setup($: $, args: string[]): Promise<string> {
  const confirm = args[0] === 'confirm'
  // A chord has spaces in it (`ctrl+x v`): the rest of the words are the key.
  const key = (confirm ? args.slice(1) : args).join(' ') || DEFAULT_CHORD
  const path = await keybindingsPath($)
  const m = t()
  const merged = mergeBinding(await readOptional($, path), key)
  if (merged.kind === 'present') return m.setupPresent(path, key)
  if (merged.kind === 'conflict') return m.setupConflict(path, key, merged.action)
  if (merged.kind === 'invalid') return m.setupInvalid(path, merged.reason)
  if (!confirm) return m.setupPlan(path, key)
  await $.fs.write(path, merged.text)
  chord = key
  redraw($)
  return m.setupDone(path, key)
}

async function config($: $): Promise<string> {
  const m = t()
  const asrFrom = asrKey ? 'asr_api_key' : (await $.env.get('CC_VOICE_API_KEY')) ? 'CC_VOICE_API_KEY' : ''
  const fix = await fixApiKey($)
  return [
    m.configTitle,
    `  shortcut       ${chord ?? m.noChord}`,
    `  asr_base_url   ${asrBaseUrl || m.unset}`,
    `  asr_model      ${asrModel || m.unset}`,
    `  asr_api_key    ${asrFrom ? m.keyFrom(asrFrom) : m.unset}`,
    `  language       ${language}`,
    `  hotwords       ${hotwords.join(', ') || '-'}`,
    `  device         ${device}`,
    `  max_seconds    ${maxSeconds}`,
    `  fix_enabled    ${fixEnabled}`,
    `  fix_base_url   ${fixBaseUrl || m.unset}`,
    `  fix_model      ${fixModel || m.unset}`,
    `  fix_api_key    ${fix.from ? m.keyFrom(fix.from) : m.unset}`,
    `  fix_extra_body ${fixExtraError ? `invalid: ${fixExtraError}` : JSON.stringify(fixExtra)}`,
  ].join('\n')
}

async function dictateCommand($: $, rawArgs: string): Promise<string | undefined> {
  const args = rawArgs.trim().split(/\s+/).filter(Boolean)
  const sub = (args[0] ?? '').toLowerCase()
  if (sub === '') {
    void toggle($)
    return undefined
  }
  if (sub === 'cancel') {
    cancel($)
    return undefined
  }
  if (sub === 'retry') {
    void retry($)
    return undefined
  }
  if (sub === 'test') {
    if (state.kind !== 'idle') return t().stillWorking
    void record($, 'test')
    return undefined
  }
  if (sub === 'config') return config($)
  if (sub === 'setup') return setup($, args.slice(1))
  return t().usage
}

function elapsed(): number {
  return state.kind === 'recording' ? (now - state.startedAt) / 1000 : 0
}

export const register: Register = (on, options) => {
  asrBaseUrl = String(options.asr_base_url ?? '').trim()
  asrModel = String(options.asr_model ?? '').trim()
  asrKey = String(options.asr_api_key ?? '').trim()
  fixEnabled = options.fix_enabled === true
  fixBaseUrl = String(options.fix_base_url ?? '').trim()
  fixModel = String(options.fix_model ?? '').trim()
  fixKey = String(options.fix_api_key ?? '').trim()
  hotwords = parseHotwords(String(options.hotwords ?? ''))
  language = String(options.language ?? '').trim() || 'auto'
  device = String(options.device ?? '').trim() || 'auto'
  const max = Number(options.max_seconds)
  maxSeconds = Number.isFinite(max) && max >= 5 ? Math.min(max, 600) : 120
  fixExtra = {}
  fixExtraError = ''
  const extra = String(options.fix_extra_body ?? '').trim()
  if (extra) {
    try {
      const parsed: unknown = JSON.parse(extra)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a JSON object')
      fixExtra = parsed as Record<string, unknown>
    } catch (err) {
      fixExtraError = (err as Error).message
    }
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'dictate',
      description: 'cc-voice: speak into the prompt box · retry | cancel | test | config | setup',
      argumentHint: 'retry|cancel|test|config|setup',
    })
    chord = boundChord(await readOptional($, await keybindingsPath($)))
    redraw($)
    if (fixExtraError) $.ui.toast(`fix_extra_body: ${fixExtraError}`)
    return next(e)
  })

  on('command.run', { command: 'dictate' }, async ($, e) => {
    const text = await dictateCommand($, e.args)
    return text === undefined ? {} : { text }
  })

  // The band row: the Button that takes the push-to-talk chord, and while
  // recording, the clock with Stop and Cancel.
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Text, Button, Box } = $.ui.resolve(e)
    const m = t()
    if (state.kind === 'recording') {
      return (
        <Box flexDirection="row">
          <Text color="red">{m.recording(elapsed(), state.mode === 'test' ? TEST_SECONDS : maxSeconds)} </Text>
          <Button key="mic" label={m.stop} action={ACTION} onPress={() => press($)} />
          <Text> </Text>
          <Button key="cancel" label={m.cancel} onPress={() => cancel($)} />
        </Box>
      )
    }
    if (state.kind === 'transcribing') {
      return (
        <Box flexDirection="row">
          <Text dimColor>{state.step === 'fix' ? m.fixing : m.transcribing}</Text>
        </Box>
      )
    }
    return <Button key="mic" label={m.idle(chord)} plain dimColor action={ACTION} onPress={() => press($)} />
  })
}
