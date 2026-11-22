// Which recorder to run, and how: the plugin only ever records 16 kHz mono
// s16le raw PCM to a file, so a stop at any moment leaves a usable file.

export type Run = (argv: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>

export type Recorder = { name: string; argv: (file: string) => string[] }

const RATE = '16000'

export function arecord(device: string): Recorder {
  return {
    name: `arecord ${device}`,
    argv: (file) => ['arecord', '-q', '-D', device, '-f', 'S16_LE', '-r', RATE, '-c', '1', '-t', 'raw', file],
  }
}

export function parecord(source?: string): Recorder {
  return {
    name: source ? `parecord ${source}` : 'parecord (default source)',
    argv: (file) => [
      'parecord',
      '--raw',
      '--format=s16le',
      `--rate=${RATE}`,
      '--channels=1',
      // parecord buffers ~2 s by default and drops what it has not written when
      // stopped, which cut off the last words; a short latency keeps the file current.
      '--latency-msec=50',
      ...(source ? [`--device=${source}`] : []),
      file,
    ],
  }
}

/** Pulse/PipeWire sources that are real inputs, not monitors of an output or the null sink. */
export function realSources(pactlShort: string): string[] {
  return pactlShort
    .split('\n')
    .map((line) => line.split('\t')[1]?.trim() ?? '')
    .filter((name) => name && !name.endsWith('.monitor') && !name.startsWith('auto_null'))
}

/** ALSA capture devices from `arecord -l`, as `plughw:card,device`. */
export function alsaDevices(arecordList: string): string[] {
  const out: string[] = []
  // English and translated listings alike: "card 0: ... device 6: ..."
  for (const m of arecordList.matchAll(/card (\d+):.*?device (\d+):/g)) out.push(`plughw:${m[1]},${m[2]}`)
  return out
}

async function tryRun(run: Run, argv: string[]): Promise<string | undefined> {
  try {
    const r = await run(argv)
    return r.exitCode === 0 ? r.stdout : undefined
  } catch {
    return undefined
  }
}

/**
 * The recorder for `device`: `auto` picks a real Pulse/PipeWire source when
 * there is one, else the first ALSA capture device; `pulse` or `pulse:<source>`
 * forces parecord; anything else is an ALSA device name for arecord.
 */
export async function chooseRecorder(device: string, run: Run): Promise<Recorder> {
  const d = device.trim() || 'auto'
  if (d === 'pulse') return parecord()
  if (d.startsWith('pulse:')) return parecord(d.slice('pulse:'.length))
  if (d !== 'auto') return arecord(d)
  const pactl = await tryRun(run, ['pactl', 'list', 'short', 'sources'])
  if (pactl !== undefined && realSources(pactl).length > 0) return parecord()
  const list = await tryRun(run, ['arecord', '-l'])
  const first = list !== undefined ? alsaDevices(list)[0] : undefined
  return arecord(first ?? 'default')
}

/** A recorder's failure, in words: busy, missing, or its own stderr. */
export function recorderFailure(stderr: string, code: number | null): 'busy' | 'missing' | string {
  if (/busy/i.test(stderr)) return 'busy'
  if (/not found|ENOENT|No such file or directory.*(arecord|parecord)/i.test(stderr)) return 'missing'
  const line = stderr.trim().split('\n').pop() ?? ''
  return line || `exit code ${code}`
}
