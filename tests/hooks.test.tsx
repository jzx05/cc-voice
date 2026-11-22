import { expect, mock, test } from 'claude-code/testing'

import { toBase64 } from '../hooks/bytes'

// The test environment has timers but no DOM typings.
declare const setTimeout: (fn: () => void, ms: number) => unknown

const BAND = { plugin: 'cc-voice', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false } } as any

/** A clip of `secs` seconds of a tone at about -20 dB, as raw s16le. */
function clip(secs: number): string {
  const n = Math.round(secs * 16000)
  const bytes = new Uint8Array(n * 2)
  for (let i = 0; i < n; i++) {
    const s = Math.round(3277 * Math.sin(i / 8)) & 0xffff
    bytes[2 * i] = s & 0xff
    bytes[2 * i + 1] = s >> 8
  }
  return toBase64(bytes)
}

type World = {
  runs: { argv: string[]; stdin?: string }[]
  spawned: string[][]
  writes: Record<string, string>
  fills: { text: string; mode?: string }[]
  toasts: string[]
  logs: string[]
  /** Ends the running recorder as if it died on its own, with this stderr. */
  die: (stderr: string) => void
  clock: ReturnType<typeof mock.clock>
}

function world(
  on: any,
  opts: {
    env?: Record<string, string>
    sources?: string
    audio?: string
    asr?: { status: number; text: string }
    box?: { text: string; cursor: number }
    files?: Record<string, string>
    busy?: boolean
    dialog?: boolean
  } = {},
): World {
  const w = { runs: [], spawned: [], writes: {}, fills: [], toasts: [], logs: [], die: () => {} } as unknown as World
  mock.env(on, opts.env ?? { CC_VOICE_API_KEY: 'vk', HOME: '/h', TMPDIR: '/tmp' })
  mock.store(on)
  w.clock = mock.clock(on)
  const files: Record<string, string> = { ...opts.files }
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_: any, e: any) => ({ value: { command: e.name } }))
  on('ui.toast', (_: any, e: any) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_: any, e: any) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('process.hookEnv', () => ({ value: { CLAUDE_CODE_SESSION_ID: 's-1' } }))
  on('fs.write', (_: any, e: any) => {
    w.writes[e.path] = e.text
    files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.read', (_: any, e: any) => {
    if (e.as === 'bytes') return { value: { base64: opts.audio ?? clip(1) } }
    if (e.path in files) return { value: files[e.path] }
    throw new Error('ENOENT')
  })
  on('fs.stat', () => ({ value: { size: Math.floor(((opts.audio ?? clip(1)).length * 3) / 4), kind: 'file', mtimeMs: 0 } }))
  on('process.run', (_: any, e: any) => {
    w.runs.push({ argv: e.argv, stdin: e.init?.stdin })
    const cmd = e.argv[0]
    if (cmd === 'pactl') return { value: { exitCode: 0, stdout: opts.sources ?? '4\talsa_input.usb\tm\ts16le\tIDLE\n', stderr: '' } }
    if (cmd === 'sh') return { value: { exitCode: 0, stdout: '', stderr: '' } }
    if (cmd === 'curl') {
      const a = opts.asr ?? { status: 200, text: '{"text":"<|zh|>帮我写个测试"}' }
      return { value: { exitCode: 0, stdout: `${a.text}\n${a.status}`, stderr: '' } }
    }
    throw new Error(`ENOENT ${cmd}`)
  })
  on('process.spawn', async function* (_: any, e: any, next: any) {
    w.spawned.push(e.argv)
    if (opts.busy) {
      yield { stream: 'stderr', text: 'Stream error: Device or resource busy\n' }
      return { value: { code: 1, signal: null } }
    }
    // Records until the plugin leaves the loop (a stop) or the test kills it.
    const died = await new Promise<string | undefined>((resolve) => {
      w.die = resolve
      next.signal?.addEventListener('abort', () => resolve(undefined))
    })
    if (died === undefined) return { value: { code: null, signal: 'SIGTERM' } }
    yield { stream: 'stderr', text: died }
    return { value: { code: 1, signal: null } }
  })
  on('prompt.read', () => ({ value: opts.box ?? { text: '', cursor: 0 } }))
  on('prompt.fill', (_: any, e: any) => {
    if (opts.dialog) return { isFilled: false, refusal: 'dialog' }
    w.fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  return w
}

/** Lets the plugin's background work run: the recording loop, the upload. */
async function settle() {
  for (let i = 0; i < 40; i++) await new Promise<void>((r) => setTimeout(r, 1))
}

const dictate = ($: any, args = '') => $.command.run({ command: 'dictate', args })

test('/dictate twice: records, uploads by curl with the key on stdin, inserts at the cursor', async ($, on) => {
  const w = world(on, { box: { text: 'fix', cursor: 3 }, asr: { status: 200, text: '{"text":"the login bug"}' } })
  await $.session.start({ cwd: '/w' } as any)
  await dictate($)
  await settle()
  expect(w.spawned[0]).toEqual(['parecord', '--raw', '--format=s16le', '--rate=16000', '--channels=1', '/tmp/cc-voice/s-1.raw'])
  await dictate($)
  await settle()
  const curl = w.runs.find((r) => r.argv[0] === 'curl')!
  expect(curl.stdin).toBe('Authorization: Bearer vk\n')
  expect(curl.argv.join(' ')).not.toContain('vk')
  expect(curl.argv).toContain('file=@/tmp/cc-voice/s-1.wav;type=audio/wav')
  expect(curl.argv[curl.argv.length - 1]).toBe('https://api.siliconflow.cn/v1/audio/transcriptions')
  const sh = w.runs.find((r) => r.argv[0] === 'sh')!
  expect(sh.argv).toEqual(['sh', '-c', 'base64 -d > "$0"', '/tmp/cc-voice/s-1.wav'])
  expect(sh.stdin!.startsWith(toBase64(new TextEncoder().encode('RIFF')).slice(0, 4))).toBe(true)
  expect(w.fills).toEqual([{ text: ' the login bug', mode: 'insert' }])
  expect(w.toasts).toEqual([])
})

test('the band Button takes the push-to-talk chord and shows the recording', async ($, on) => {
  const w = world(on, { files: { '/h/.claude/keybindings.json': '{"bindings":[{"context":"Global","bindings":{"alt+v":"voice:pushToTalk"}}]}' } })
  await $.session.start({ cwd: '/w' } as any)
  let ui = await $.ui.mount(BAND)
  const mic = await ui.find({ key: 'mic' })
  expect(mic?.text).toBe('🎙 alt+v')
  expect((mic as any)?.props?.action).toBe('voice:pushToTalk')
  await ui.press({ key: 'mic' })
  await settle()
  await ui.unmount()
  ui = await $.ui.mount(BAND)
  expect((await ui.find({ type: 'Text', text: /录音中 0:00 \/ 2:00/ }))).toBeDefined()
  await ui.press({ key: 'mic' })
  await settle()
  expect(w.fills).toEqual([{ text: '帮我写个测试', mode: 'insert' }])
  await ui.unmount()
})

test('cancel discards the recording: no upload, nothing to retry', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/w' } as any)
  await dictate($)
  await settle()
  await dictate($, 'cancel')
  await settle()
  expect(w.runs.some((r) => r.argv[0] === 'curl')).toBe(false)
  expect(w.toasts).toEqual(['已取消，录音已丢弃'])
  await dictate($, 'retry')
  await settle()
  expect(w.toasts[1]).toBe('没有可以重新转写的录音')
})

test('no API key: says so before recording', async ($, on) => {
  const w = world(on, { env: { HOME: '/h' } })
  await $.session.start({ cwd: '/w' } as any)
  await dictate($)
  await settle()
  expect(w.spawned).toEqual([])
  expect(w.toasts[0]).toContain('CC_VOICE_API_KEY')
})

test('a busy microphone is reported, and nothing is uploaded', async ($, on) => {
  const w = world(on, { busy: true })
  await $.session.start({ cwd: '/w' } as any)
  await dictate($)
  await settle()
  expect(w.toasts).toEqual(['麦克风被占用（另一个程序或会话正在录音）'])
  expect(w.runs.some((r) => r.argv[0] === 'curl')).toBe(false)
})

test('a failed upload leaves the box alone; /dictate retry sends the same recording again', async ($, on) => {
  const w = world(on, { asr: { status: 503, text: 'busy' } })
  await $.session.start({ cwd: '/w' } as any)
  await dictate($)
  await settle()
  await dictate($)
  await settle()
  expect(w.fills).toEqual([])
  expect(w.toasts[0]).toBe('转写失败：HTTP 503 · /dictate retry 重新转写这段录音')
  await dictate($, 'retry')
  await settle()
  expect(w.runs.filter((r) => r.argv[0] === 'curl').length).toBe(2)
  expect(w.spawned.length).toBe(1)
})

test('too short a recording is not uploaded', async ($, on) => {
  const w = world(on, { audio: clip(0.1) })
  await $.session.start({ cwd: '/w' } as any)
  await dictate($)
  await settle()
  await dictate($)
  await settle()
  expect(w.toasts).toEqual(['录音太短，没有转写'])
  expect(w.runs.some((r) => r.argv[0] === 'curl')).toBe(false)
})

test('an empty transcript is reported, nothing inserted', async ($, on) => {
  const w = world(on, { asr: { status: 200, text: '{"text":"<|zh|><|NEUTRAL|>"}' } })
  await $.session.start({ cwd: '/w' } as any)
  await dictate($)
  await settle()
  await dictate($)
  await settle()
  expect(w.fills).toEqual([])
  expect(w.toasts[0]).toContain('没有识别出文字')
})

test('the correction step runs when enabled, and falls back to the raw transcript', { options: { fix_enabled: true, fix_base_url: 'https://api.deepseek.com', fix_model: 'deepseek-flash' } }, async ($, on) => {
  const w = world(on, { env: { CC_VOICE_API_KEY: 'vk', CC_TRANSLATE_API_KEY: 'tk', HOME: '/h', TMPDIR: '/tmp' }, asr: { status: 200, text: '{"text":"改一下优思 effect"}' } })
  const sent: any[] = []
  let status = 200
  on('http.fetch', (_: any, e: any) => {
    sent.push({ url: e.url, auth: e.init.headers.authorization, body: JSON.parse(e.init.body) })
    return { value: { status, ok: status < 300, headers: {}, text: JSON.stringify({ choices: [{ message: { content: '改一下 useEffect' } }] }) } }
  })
  await $.session.start({ cwd: '/w' } as any)
  await dictate($)
  await settle()
  await dictate($)
  await settle()
  expect(sent[0].url).toBe('https://api.deepseek.com/chat/completions')
  expect(sent[0].auth).toBe('Bearer tk') // shared with cc-translate
  expect(w.fills).toEqual([{ text: '改一下 useEffect', mode: 'insert' }])
  status = 500
  await dictate($)
  await settle()
  await dictate($)
  await settle()
  expect(w.fills[1]).toEqual({ text: '改一下优思 effect', mode: 'insert' })
  expect(w.toasts[0]).toContain('修正失败（HTTP 500）')
})

test('options: language and hotwords reach the transcriber; device picks the recorder', { options: { language: 'zh', hotwords: 'useEffect，pnpm', device: 'plughw:0,7' } }, async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/w' } as any)
  await dictate($)
  await settle()
  expect(w.spawned[0]!.slice(0, 4)).toEqual(['arecord', '-q', '-D', 'plughw:0,7'])
  await dictate($)
  await settle()
  const curl = w.runs.find((r) => r.argv[0] === 'curl')!.argv
  expect(curl).toContain('language=zh')
  expect(curl).toContain('prompt=useEffect, pnpm')
})

test('/dictate test reports levels and what was heard, inserting nothing', async ($, on) => {
  const w = world(on)
  const clock = w.clock
  await $.session.start({ cwd: '/w' } as any)
  await dictate($, 'test')
  await settle()
  await clock.advance(3000)
  await settle()
  expect(w.fills).toEqual([])
  expect(w.logs).toEqual([
    '测试结果',
    '  录音程序  parecord (default source)',
    '  时长      1.0 秒',
    '  峰值      -20.0 dB（放大 17 dB 后约 -3.0 dB）',
    '  平均      -23.0 dB',
    '  识别结果  帮我写个测试',
  ])
})

test('/dictate setup shows the plan; confirm writes it; a second run finds it present', async ($, on) => {
  const path = '/h/.claude/keybindings.json'
  const w = world(on, { files: { [path]: '{"bindings":[{"context":"Chat","bindings":{"ctrl+e":"chat:externalEditor"}}]}' } })
  await $.session.start({ cwd: '/w' } as any)
  const plan = await dictate($, 'setup')
  expect(plan.text).toContain('"alt+v": "voice:pushToTalk"')
  expect(w.writes[path]).toBeUndefined()
  const done = await dictate($, 'setup confirm')
  expect(done.text).toContain('已写入')
  expect(JSON.parse(w.writes[path]!).bindings).toEqual([
    { context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor' } },
    { context: 'Global', bindings: { 'alt+v': 'voice:pushToTalk' } },
  ])
  expect((await dictate($, 'setup')).text).toContain('无需修改')
})

test('/dictate setup with a chord that is taken changes nothing', async ($, on) => {
  const path = '/x/keybindings.json'
  const w = world(on, { env: { CC_VOICE_API_KEY: 'vk', HOME: '/h', CLAUDE_CONFIG_DIR: '/x' }, files: { [path]: '{"bindings":[{"context":"Global","bindings":{"ctrl+q":"app:exit"}}]}' } })
  await $.session.start({ cwd: '/w' } as any)
  const r = await dictate($, 'setup confirm ctrl+q')
  expect(r.text).toContain('已经绑定到 app:exit')
  expect(w.writes[path]).toBeUndefined()
})

test('/dictate config names where each key comes from, never the key', { options: { asr_api_key: 'secret-asr' } }, async ($, on) => {
  world(on, { env: { CC_TRANSLATE_API_KEY: 'secret-tr', HOME: '/h' } })
  await $.session.start({ cwd: '/w' } as any)
  const { text } = await dictate($, 'config')
  expect(text).toContain('asr_api_key    已设置（asr_api_key）')
  expect(text).toContain('fix_api_key    已设置（CC_TRANSLATE_API_KEY）')
  expect(text).toContain('asr_model      FunAudioLLM/SenseVoiceSmall')
  expect(text).not.toContain('secret')
})

test('English messages with language en', { options: { language: 'en' } }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/w' } as any)
  expect((await dictate($, 'nonsense')).text).toBe('usage: /dictate [retry | cancel | test | config | setup [confirm] [chord]]')
})

test('a box that cannot take the text: the transcript is shown instead', async ($, on) => {
  const w = world(on, { dialog: true })
  await $.session.start({ cwd: '/w' } as any)
  await dictate($)
  await settle()
  await dictate($)
  await settle()
  expect(w.logs).toEqual(['输入框现在不能输入，识别结果：帮我写个测试'])
})
