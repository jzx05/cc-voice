// What a transcript becomes before it enters the prompt box.

/** Drops a transcriber's markup: SenseVoice's `<|zh|><|NEUTRAL|>` tags, stray whitespace. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/<\|[^|>]*\|>/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

const LATIN = /[A-Za-z0-9]/

/**
 * The text to insert between `before` and `after` (the box's text around the
 * cursor): trimmed, with a space where it would otherwise glue a Latin word to
 * a Latin word. Chinese never gets spaces.
 */
export function joinAtCursor(before: string, inserted: string, after: string): string {
  const text = inserted.trim()
  if (!text) return ''
  const prev = before.slice(-1)
  const next = after.slice(0, 1)
  const lead = prev && LATIN.test(prev) && LATIN.test(text[0]!) ? ' ' : ''
  const trail = next && LATIN.test(next) && LATIN.test(text[text.length - 1]!) ? ' ' : ''
  return lead + text + trail
}

/** Hotwords as a clean list: comma, Chinese comma or newline separated. */
export function parseHotwords(raw: string): string[] {
  return raw
    .split(/[,，、\n]/)
    .map((w) => w.trim())
    .filter(Boolean)
}
