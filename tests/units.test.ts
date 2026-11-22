import { expect, test } from 'claude-code/testing'

import { levels, normalize, pcmFromBytes, seconds, wav } from '../hooks/audio'
import { concat, fromBase64, toBase64 } from '../hooks/bytes'
import { messages, uiLang } from '../hooks/i18n'
import { ACTION, boundChord, mergeBinding } from '../hooks/keybindings'
import { alsaDevices, chooseRecorder, realSources, recorderFailure } from '../hooks/recorder'
import { cleanTranscript, joinAtCursor, parseHotwords } from '../hooks/text'

test('base64 round-trips every byte value and every padding length', () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i)
  expect(Array.from(fromBase64(toBase64(all)))).toEqual(Array.from(all))
  expect(toBase64(Uint8Array.from([0x4d]))).toBe('TQ==')
  expect(toBase64(Uint8Array.from([0x4d, 0x61]))).toBe('TWE=')
  expect(toBase64(Uint8Array.from([0x4d, 0x61, 0x6e]))).toBe('TWFu')
  expect(Array.from(fromBase64('TWE='))).toEqual([0x4d, 0x61])
  expect(Array.from(concat([Uint8Array.from([1]), Uint8Array.from([2, 3])]))).toEqual([1, 2, 3])
})

test('raw s16le bytes become signed samples', () => {
  const pcm = pcmFromBytes(Uint8Array.from([0x01, 0x00, 0xff, 0xff, 0x00, 0x80, 0xff, 0x7f, 0x09]))
  expect(Array.from(pcm)).toEqual([1, -1, -32768, 32767]) // the odd trailing byte is dropped
  expect(seconds(new Int16Array(8000))).toBe(0.5)
})

test('levels: full scale is 0 dB, half is about -6 dB, silence is -Infinity', () => {
  expect(levels(Int16Array.from([32767, -32768])).peakDb).toBe(0)
  expect(levels(Int16Array.from([16384, -16384])).peakDb).toBe(-6)
  expect(levels(Int16Array.from([16384, -16384])).meanDb).toBe(-6)
  expect(levels(new Int16Array(10)).peakDb).toBe(-Infinity)
})

test('normalize lifts a quiet recording to -3 dB, capped at +30 dB, never quieter', () => {
  const quiet = Int16Array.from([0, 650, -650]) // about -34 dB, the laptop DMIC's level
  const { pcm, gainDb } = normalize(quiet)
  expect(gainDb).toBe(30) // -34 dB wants +31 dB: capped
  expect(levels(pcm).peakDb).toBe(-4.1)
  const medium = Int16Array.from([3277]) // -20 dB
  expect(normalize(medium).gainDb).toBe(17)
  expect(levels(normalize(medium).pcm).peakDb).toBe(-3)
  const loud = Int16Array.from([32000])
  expect(normalize(loud).gainDb).toBe(0)
  expect(normalize(loud).pcm).toBe(loud)
  expect(normalize(new Int16Array(4)).gainDb).toBe(0)
})

test('wav: a 44-byte RIFF header, then the samples little-endian', () => {
  const file = wav(Int16Array.from([1, -2]))
  const ascii = (a: number, b: number) => String.fromCharCode(...file.subarray(a, b))
  const v = new DataView(file.buffer)
  expect(file.length).toBe(48)
  expect(ascii(0, 4)).toBe('RIFF')
  expect(v.getUint32(4, true)).toBe(40)
  expect(ascii(8, 16)).toBe('WAVEfmt ')
  expect(v.getUint16(20, true)).toBe(1)
  expect(v.getUint16(22, true)).toBe(1)
  expect(v.getUint32(24, true)).toBe(16000)
  expect(v.getUint32(28, true)).toBe(32000)
  expect(v.getUint16(34, true)).toBe(16)
  expect(ascii(36, 40)).toBe('data')
  expect(v.getUint32(40, true)).toBe(4)
  expect(v.getInt16(44, true)).toBe(1)
  expect(v.getInt16(46, true)).toBe(-2)
})

test('transcripts lose SenseVoice tags and stray whitespace', () => {
  expect(cleanTranscript('<|zh|><|NEUTRAL|><|Speech|><|withitn|>帮我  写个测试。 ')).toBe('帮我 写个测试。')
  expect(cleanTranscript('  hello hello,你好。\n')).toBe('hello hello,你好。')
})

test('joinAtCursor spaces Latin from Latin only', () => {
  expect(joinAtCursor('say', 'hello', '')).toBe(' hello')
  expect(joinAtCursor('say ', 'hello', '')).toBe('hello')
  expect(joinAtCursor('修一下', 'login', '')).toBe('login')
  expect(joinAtCursor('fix', '登录的 bug', '')).toBe('登录的 bug')
  expect(joinAtCursor('', 'run tests', 'now')).toBe('run tests ')
  expect(joinAtCursor('', '运行测试', 'now')).toBe('运行测试')
  expect(joinAtCursor('a', '  ', 'b')).toBe('')
})

test('hotwords split on commas of either width and newlines', () => {
  expect(parseHotwords('useEffect, pnpm，Kubernetes、 git rebase\n\n')).toEqual(['useEffect', 'pnpm', 'Kubernetes', 'git rebase'])
  expect(parseHotwords('')).toEqual([])
})

test('pactl sources: monitors and the null sink are not microphones', () => {
  const nullOnly = '2\tauto_null.monitor\tmodule-null-sink.c\ts16le 2ch 44100Hz\tSUSPENDED\n'
  expect(realSources(nullOnly)).toEqual([])
  const usb =
    '3\talsa_output.usb-X.analog-stereo.monitor\tmodule-alsa-card.c\ts16le 2ch 44100Hz\tSUSPENDED\n' +
    '4\talsa_input.usb-X.analog-stereo\tmodule-alsa-card.c\ts16le 2ch 48000Hz\tSUSPENDED\n'
  expect(realSources(usb)).toEqual(['alsa_input.usb-X.analog-stereo'])
})

test('arecord -l, in English or translated, gives plughw devices', () => {
  const zh = '**** CAPTURE 硬體裝置清單 ****\ncard 0: sofhdadsp [sof-hda-dsp], device 6: DMIC (*) []\n  子设备: 1/1\ncard 0: sofhdadsp [sof-hda-dsp], device 7: DMIC16kHz (*) []\n'
  expect(alsaDevices(zh)).toEqual(['plughw:0,6', 'plughw:0,7'])
  expect(alsaDevices('')).toEqual([])
})

const runner = (answers: Record<string, { exitCode: number; stdout: string } | Error>) => async (argv: string[]) => {
  const a = answers[argv[0]!]
  if (!a || a instanceof Error) throw a ?? new Error('ENOENT')
  return { ...a, stderr: '' }
}

test('auto: a real Pulse/PipeWire source wins, recorded by parecord', async () => {
  const r = await chooseRecorder('auto', runner({ pactl: { exitCode: 0, stdout: '4\talsa_input.usb\tm\ts16le\tIDLE\n' } }))
  expect(r.argv('/t/x.raw')).toEqual(['parecord', '--raw', '--format=s16le', '--rate=16000', '--channels=1', '/t/x.raw'])
})

test('auto: no real source, so the first ALSA device by arecord; none, so default', async () => {
  const nul = { exitCode: 0, stdout: '2\tauto_null.monitor\tm\ts16le\tSUSPENDED\n' }
  const r = await chooseRecorder('auto', runner({ pactl: nul, arecord: { exitCode: 0, stdout: 'card 1: X [x], device 0: Y [y]\n' } }))
  expect(r.argv('/t/x.raw')).toEqual(['arecord', '-q', '-D', 'plughw:1,0', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'raw', '/t/x.raw'])
  const none = await chooseRecorder('auto', runner({}))
  expect(none.argv('f')[3]).toBe('default')
})

test('device names: pulse, pulse:<source>, or an ALSA device', async () => {
  const run = runner({})
  expect((await chooseRecorder('pulse', run)).argv('f')[0]).toBe('parecord')
  expect((await chooseRecorder('pulse:mic1', run)).argv('f')).toContain('--device=mic1')
  expect((await chooseRecorder('plughw:0,7', run)).argv('f').slice(0, 4)).toEqual(['arecord', '-q', '-D', 'plughw:0,7'])
})

test('recorder failures: busy, missing, or the last stderr line', () => {
  expect(recorderFailure('arecord: main:850: audio open error: Device or resource busy', 1)).toBe('busy')
  expect(recorderFailure('spawn arecord ENOENT', null)).toBe('missing')
  expect(recorderFailure('line one\nStream error: Connection refused\n', 1)).toBe('Stream error: Connection refused')
  expect(recorderFailure('', 2)).toBe('exit code 2')
})

test('keybindings: adds the chord to Global, keeping everything else', () => {
  const current = JSON.stringify({ $schema: 's', bindings: [{ context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor' } }] })
  const r = mergeBinding(current, 'alt+v')
  expect(r.kind).toBe('added')
  const doc = JSON.parse((r as { text: string }).text)
  expect(doc.$schema).toBe('s')
  expect(doc.bindings[0]).toEqual({ context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor' } })
  expect(doc.bindings[1]).toEqual({ context: 'Global', bindings: { 'alt+v': ACTION } })
  expect(boundChord((r as { text: string }).text)).toBe('alt+v')
})

test('keybindings: no file, an existing Global, present, conflict, invalid', () => {
  expect(JSON.parse((mergeBinding(undefined, 'alt+v') as { text: string }).text)).toEqual({ bindings: [{ context: 'Global', bindings: { 'alt+v': ACTION } }] })
  const g = JSON.stringify({ bindings: [{ context: 'Global', bindings: { 'ctrl+q': 'app:exit' } }] })
  expect(JSON.parse((mergeBinding(g, 'alt+v') as { text: string }).text).bindings).toEqual([{ context: 'Global', bindings: { 'ctrl+q': 'app:exit', 'alt+v': ACTION } }])
  expect(mergeBinding(g, 'ctrl+q')).toEqual({ kind: 'conflict', action: 'app:exit' })
  const present = (mergeBinding(undefined, 'alt+v') as { text: string }).text
  expect(mergeBinding(present, 'alt+v')).toEqual({ kind: 'present' })
  expect(mergeBinding('{', 'alt+v').kind).toBe('invalid')
  expect(mergeBinding('{"bindings":{}}', 'alt+v').kind).toBe('invalid')
  expect(boundChord(undefined)).toBeUndefined()
})

test('messages follow language: English for en, Chinese otherwise', () => {
  expect(uiLang('auto')).toBe('zh')
  expect(uiLang('zh')).toBe('zh')
  expect(uiLang('en')).toBe('en')
  expect(uiLang('en-US')).toBe('en')
  expect(messages('zh').recording(65, 120)).toBe('● 录音中 1:05 / 2:00')
  expect(messages('en').recording(5, 120)).toBe('● Recording 0:05 / 2:00')
})
