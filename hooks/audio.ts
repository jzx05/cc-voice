// Audio in memory: 16-bit little-endian mono PCM as the recorder writes it,
// its loudness, a peak normalisation, and the WAV file the transcriber gets.

export const SAMPLE_RATE = 16000

/** Samples from raw s16le bytes (an odd trailing byte is dropped). */
export function pcmFromBytes(bytes: Uint8Array): Int16Array {
  const n = bytes.length >> 1
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const v = bytes[2 * i]! | (bytes[2 * i + 1]! << 8)
    out[i] = v >= 0x8000 ? v - 0x10000 : v
  }
  return out
}

export function seconds(pcm: Int16Array, rate = SAMPLE_RATE): number {
  return pcm.length / rate
}

/** dBFS of a 0..1 level; -Infinity for silence, rounded to 0.1 dB. */
function db(level: number): number {
  if (level <= 0) return -Infinity
  return Math.round(200 * Math.log10(level)) / 10
}

/** Peak and mean (RMS) level in dBFS. */
export function levels(pcm: Int16Array): { peakDb: number; meanDb: number } {
  let peak = 0
  let sum = 0
  for (let i = 0; i < pcm.length; i++) {
    const s = pcm[i]!
    const a = Math.abs(s)
    if (a > peak) peak = a
    sum += s * s
  }
  const rms = pcm.length ? Math.sqrt(sum / pcm.length) : 0
  return { peakDb: db(peak / 32768), meanDb: db(rms / 32768) }
}

/**
 * Scales the samples so the loudest reaches `targetDb`, by at most
 * `maxGainDb`; never makes a recording quieter. Returns the gain applied.
 */
export function normalize(pcm: Int16Array, targetDb = -3, maxGainDb = 30): { pcm: Int16Array; gainDb: number } {
  const { peakDb } = levels(pcm)
  if (!Number.isFinite(peakDb)) return { pcm, gainDb: 0 }
  const gainDb = Math.min(maxGainDb, Math.max(0, targetDb - peakDb))
  if (gainDb < 0.5) return { pcm, gainDb: 0 }
  const g = Math.pow(10, gainDb / 20)
  const out = new Int16Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.round(pcm[i]! * g)
    out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v
  }
  return { pcm: out, gainDb: Math.round(gainDb * 10) / 10 }
}

/** A complete WAV file (RIFF, PCM 16-bit mono). */
export function wav(pcm: Int16Array, rate = SAMPLE_RATE): Uint8Array {
  const dataBytes = pcm.length * 2
  const out = new Uint8Array(44 + dataBytes)
  const v = new DataView(out.buffer)
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true) // fmt chunk size
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true) // byte rate
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  ascii(36, 'data')
  v.setUint32(40, dataBytes, true)
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + 2 * i, pcm[i]!, true)
  return out
}
