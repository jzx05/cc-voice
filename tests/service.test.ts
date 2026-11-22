import { expect, test } from 'claude-code/testing'

import { curlAnswer, curlArgv, fixPrompt, fixTranscript, transcribe, type Deps, type Upload } from '../hooks/service'

const asr = { baseUrl: 'https://api.siliconflow.cn/v1/', model: 'FunAudioLLM/SenseVoiceSmall', apiKey: 'k', language: 'auto', hotwords: [] as string[], timeoutMs: 60000 }

function uploader(answer: { status: number; text: string } | Error) {
  const calls: { url: string; key: string; fields: Record<string, string>; file: { path: string; type: string } }[] = []
  const upload: Upload = async (url, key, fields, file) => {
    calls.push({ url, key, fields, file })
    if (answer instanceof Error) throw answer
    return { ...answer, ok: answer.status < 300 }
  }
  return { calls, upload }
}

test('transcribe: posts model and the file to /audio/transcriptions, returns text', async () => {
  const u = uploader({ status: 200, text: '{"text":"hello hello,你好。","language":"Chinese"}' })
  expect(await transcribe(u.upload, asr, '/tmp/a.wav')).toBe('hello hello,你好。')
  expect(u.calls[0]).toEqual({
    url: 'https://api.siliconflow.cn/v1/audio/transcriptions',
    key: 'k',
    fields: { model: 'FunAudioLLM/SenseVoiceSmall', response_format: 'json' },
    file: { path: '/tmp/a.wav', type: 'audio/wav' },
  })
})

test('transcribe: a fixed language and hotwords are passed on', async () => {
  const u = uploader({ status: 200, text: '{"text":"x"}' })
  await transcribe(u.upload, { ...asr, language: 'zh', hotwords: ['useEffect', 'pnpm'] }, '/a.wav')
  expect(u.calls[0]!.fields).toEqual({ model: asr.model, response_format: 'json', language: 'zh', prompt: 'useEffect, pnpm' })
})

test('transcribe: errors name the cause, never the body', async () => {
  await expect(transcribe(uploader({ status: 401, text: 'secret echo' }).upload, asr, 'a')).rejects.toThrow('HTTP 401 (check the API key)')
  await expect(transcribe(uploader({ status: 500, text: '' }).upload, asr, 'a')).rejects.toThrow('HTTP 500')
  await expect(transcribe(uploader(new Error('curl: (6) Could not resolve host')).upload, asr, 'a')).rejects.toThrow('request failed: curl: (6)')
  await expect(transcribe(uploader({ status: 200, text: '{"nope":1}' }).upload, asr, 'a')).rejects.toThrow('no text')
  await expect(transcribe(uploader({ status: 200, text: '' }).upload, { ...asr, apiKey: '' }, 'a')).rejects.toThrow('no API key')
  await expect(transcribe(uploader({ status: 200, text: '' }).upload, { ...asr, model: '' }, 'a')).rejects.toThrow('asr_model')
})

test('transcribe: a plain-text answer is taken as the transcript', async () => {
  expect(await transcribe(uploader({ status: 200, text: 'plain words' }).upload, asr, 'a')).toBe('plain words')
})

test('curl: the key is not on the command line; fields are literal strings', () => {
  const argv = curlArgv('https://x/v1/audio/transcriptions', { model: 'm', prompt: '@etc/passwd, <x' }, { path: '/t/a.wav', type: 'audio/wav' }, 60000)
  expect(argv.join(' ')).not.toContain('Bearer')
  expect(argv.slice(0, 6)).toEqual(['curl', '-sS', '--max-time', '60', '-H', '@-'])
  expect(argv).toContain('--form-string')
  expect(argv[argv.indexOf('prompt=@etc/passwd, <x') - 1]).toBe('--form-string')
  expect(argv).toContain('file=@/t/a.wav;type=audio/wav')
  expect(argv[argv.length - 1]).toBe('https://x/v1/audio/transcriptions')
})

test('curl answer: body, then the status line', () => {
  expect(curlAnswer('{"text":"a"}\n200')).toEqual({ status: 200, ok: true, text: '{"text":"a"}' })
  expect(curlAnswer('{"err":1}\n\n401')).toEqual({ status: 401, ok: false, text: '{"err":1}\n' })
  expect(curlAnswer('000').ok).toBe(false)
})

const fix = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'fk', extraBody: { thinking: { type: 'disabled' } }, hotwords: ['useEffect'], timeoutMs: 20000 }

function poster(answer: { status: number; content?: string }) {
  const sent: { url: string; body: any; headers: Record<string, string> }[] = []
  const deps: Deps = {
    post: async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body as string), headers: init.headers })
      return { status: answer.status, ok: answer.status < 300, text: JSON.stringify({ choices: [{ message: { content: answer.content } }] }) }
    },
    delay: () => new Promise<void>(() => {}),
  }
  return { sent, deps }
}

test('fix: a chat completion with the hotwords in the prompt and extra fields merged', async () => {
  const p = poster({ status: 200, content: '<think>x</think>帮我改一下 useEffect 的依赖' })
  expect(await fixTranscript(p.deps, fix, '帮我改一下优思 effect 的依赖')).toBe('帮我改一下 useEffect 的依赖')
  const s = p.sent[0]!
  expect(s.url).toBe('https://api.deepseek.com/chat/completions')
  expect(s.headers.authorization).toBe('Bearer fk')
  expect(s.body.model).toBe('deepseek-flash')
  expect(s.body.thinking).toEqual({ type: 'disabled' })
  expect(s.body.messages[0].content).toContain('useEffect')
  expect(s.body.messages[1].content).toBe('帮我改一下优思 effect 的依赖')
  expect(fixPrompt([])).not.toContain('Terms the speaker')
})

test('fix: errors and a missing key', async () => {
  await expect(fixTranscript(poster({ status: 500 }).deps, fix, 'x')).rejects.toThrow('HTTP 500')
  await expect(fixTranscript(poster({ status: 200, content: ' ' }).deps, fix, 'x')).rejects.toThrow('empty answer')
  await expect(fixTranscript(poster({ status: 200 }).deps, { ...fix, apiKey: '' }, 'x')).rejects.toThrow('CC_TRANSLATE_API_KEY')
})

test('fix: a request that hangs times out', async () => {
  const deps: Deps = { post: () => new Promise(() => {}), delay: async () => {} }
  await expect(fixTranscript(deps, fix, 'x')).rejects.toThrow('timed out after 20s')
})
