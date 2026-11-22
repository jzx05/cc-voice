// Merging the plugin's chord into keybindings.json: one Global binding, the
// file's other bindings and formatting choices left as they are.

export const ACTION = 'voice:pushToTalk'

export type Merge =
  | { kind: 'added'; text: string }
  | { kind: 'present' }
  | { kind: 'conflict'; action: string }
  | { kind: 'invalid'; reason: string }

/** The file's text with `chord` bound to the push-to-talk action in Global. */
export function mergeBinding(current: string | undefined, chord: string): Merge {
  let doc: any = { bindings: [] }
  if (current !== undefined && current.trim() !== '') {
    try {
      doc = JSON.parse(current)
    } catch (err) {
      return { kind: 'invalid', reason: (err as Error).message }
    }
    if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return { kind: 'invalid', reason: 'not a JSON object' }
    if (doc.bindings === undefined) doc.bindings = []
    if (!Array.isArray(doc.bindings)) return { kind: 'invalid', reason: '"bindings" is not an array' }
  }
  let global = doc.bindings.find((b: any) => b && b.context === 'Global' && b.bindings && typeof b.bindings === 'object')
  const bound = global?.bindings?.[chord]
  if (bound === ACTION) return { kind: 'present' }
  if (bound !== undefined && bound !== null) return { kind: 'conflict', action: String(bound) }
  if (!global) {
    global = { context: 'Global', bindings: {} }
    doc.bindings.push(global)
  }
  global.bindings[chord] = ACTION
  return { kind: 'added', text: JSON.stringify(doc, null, 2) + '\n' }
}

/** The chord already bound to push-to-talk in Global, if any. */
export function boundChord(current: string | undefined): string | undefined {
  try {
    const doc = JSON.parse(current ?? '')
    for (const b of doc?.bindings ?? []) {
      if (b?.context !== 'Global' || !b.bindings) continue
      for (const [chord, action] of Object.entries(b.bindings)) if (action === ACTION) return chord
    }
  } catch {
    return undefined
  }
  return undefined
}
