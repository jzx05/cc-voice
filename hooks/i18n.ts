// The plugin's own words, in Chinese or English. `language` picks: English
// for `en…`, Chinese for everything else (`auto` included).

export type Lang = 'zh' | 'en'

export function uiLang(language: string): Lang {
  return /^en/i.test(language.trim()) ? 'en' : 'zh'
}

export type Messages = {
  idle: (chord: string | undefined) => string
  recording: (secs: number, max: number) => string
  transcribing: string
  fixing: string
  stop: string
  cancel: string
  cancelled: string
  tooShort: string
  empty: string
  busy: string
  missing: string
  recorderFailed: (reason: string) => string
  failed: (reason: string) => string
  fixFailed: (reason: string) => string
  noKey: string
  noRecording: string
  stillWorking: string
  notFilled: (text: string) => string
  testStart: (secs: number) => string
  testReport: (r: { recorder: string; secs: number; peakDb: number; meanDb: number; gainDb: number; text: string }) => string
  quietHint: string
  setupPlan: (path: string, chord: string) => string
  setupDone: (path: string, chord: string) => string
  setupPresent: (path: string, chord: string) => string
  setupConflict: (path: string, chord: string, action: string) => string
  setupInvalid: (path: string, reason: string) => string
  noChord: string
  configTitle: string
  keyFrom: (where: string) => string
  unset: string
  usage: string
}

const dB = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} dB` : '-∞ dB')

const zh: Messages = {
  idle: (c) => (c ? `🎙 ${c}` : '🎙 /dictate'),
  recording: (s, m) => `● 录音中 ${fmt(s)} / ${fmt(m)}`,
  transcribing: '转写中…',
  fixing: '修正中…',
  stop: '停止',
  cancel: '取消',
  cancelled: 'cc-voice：已取消，录音已丢弃',
  tooShort: 'cc-voice：录音太短，没有转写',
  empty: 'cc-voice：没有识别出文字（录音可能太小声，试试 /dictate test）',
  busy: 'cc-voice：麦克风被占用（另一个程序或会话正在录音）',
  missing: 'cc-voice：找不到录音程序：请安装 alsa-utils（arecord）或 pulseaudio-utils（parecord）',
  recorderFailed: (r) => `cc-voice：录音失败：${r}`,
  failed: (r) => `cc-voice：转写失败：${r} · /dictate retry 重新转写这段录音`,
  fixFailed: (r) => `cc-voice：修正失败（${r}），已插入原始识别结果`,
  noKey: 'cc-voice：没有识别服务的 API key：/plugin configure 设置 asr_api_key，或设置环境变量 CC_VOICE_API_KEY',
  noRecording: 'cc-voice：没有可以重新转写的录音',
  stillWorking: 'cc-voice：上一段还在转写，请稍候',
  notFilled: (t) => `cc-voice：输入框现在不能输入，识别结果：${t}`,
  testStart: (s) => `cc-voice：测试录音 ${s} 秒，请说话…`,
  testReport: (r) =>
    [
      'cc-voice 测试结果',
      `  录音程序  ${r.recorder}`,
      `  时长      ${r.secs.toFixed(1)} 秒`,
      `  峰值      ${dB(r.peakDb)}（放大 ${r.gainDb} dB 后约 ${dB(r.peakDb + r.gainDb)}）`,
      `  平均      ${dB(r.meanDb)}`,
      `  识别结果  ${r.text || '（空）'}`,
    ].join('\n'),
  quietHint: '  提示：音量偏低，可以用 alsamixer 调高麦克风（Capture）增益，识别会更准',
  setupPlan: (p, c) =>
    `cc-voice 将在 ${p} 的 Global 中加入：\n  "${c}": "voice:pushToTalk"\n其他绑定保持不变。确认请运行 /dictate setup confirm${c === 'alt+v' ? '' : ` ${c}`}`,
  setupDone: (p, c) => `cc-voice：已写入 ${p}，现在在输入框里按 ${c} 开始 / 停止录音`,
  setupPresent: (p, c) => `cc-voice：${p} 里已经有 ${c} → voice:pushToTalk，无需修改`,
  setupConflict: (p, c, a) => `cc-voice：${p} 里 ${c} 已经绑定到 ${a}，没有改动。换一个键：/dictate setup <键>，比如 /dictate setup alt+r`,
  setupInvalid: (p, r) => `cc-voice：${p} 不是有效的 JSON（${r}），没有改动`,
  noChord: '未绑定快捷键：/dictate setup',
  configTitle: 'cc-voice 当前配置',
  keyFrom: (w) => `已设置（${w}）`,
  unset: '未设置',
  usage: '用法：/dictate [retry | cancel | test | config | setup [confirm] [键]]',
}

const en: Messages = {
  idle: (c) => (c ? `🎙 ${c}` : '🎙 /dictate'),
  recording: (s, m) => `● Recording ${fmt(s)} / ${fmt(m)}`,
  transcribing: 'Transcribing…',
  fixing: 'Correcting…',
  stop: 'Stop',
  cancel: 'Cancel',
  cancelled: 'cc-voice: cancelled, the recording was discarded',
  tooShort: 'cc-voice: too short to transcribe',
  empty: 'cc-voice: no speech recognised (too quiet? try /dictate test)',
  busy: 'cc-voice: the microphone is busy (another program or session is recording)',
  missing: 'cc-voice: no recorder found: install alsa-utils (arecord) or pulseaudio-utils (parecord)',
  recorderFailed: (r) => `cc-voice: recording failed: ${r}`,
  failed: (r) => `cc-voice: transcription failed: ${r} · /dictate retry transcribes this recording again`,
  fixFailed: (r) => `cc-voice: correction failed (${r}); inserted the raw transcript`,
  noKey: 'cc-voice: no API key for the transcriber: set asr_api_key in /plugin configure, or CC_VOICE_API_KEY',
  noRecording: 'cc-voice: no recording to transcribe again',
  stillWorking: 'cc-voice: still transcribing the last one',
  notFilled: (t) => `cc-voice: the prompt box could not take it; you said: ${t}`,
  testStart: (s) => `cc-voice: test recording for ${s} s, speak now…`,
  testReport: (r) =>
    [
      'cc-voice test',
      `  recorder  ${r.recorder}`,
      `  length    ${r.secs.toFixed(1)} s`,
      `  peak      ${dB(r.peakDb)} (about ${dB(r.peakDb + r.gainDb)} after +${r.gainDb} dB)`,
      `  mean      ${dB(r.meanDb)}`,
      `  heard     ${r.text || '(nothing)'}`,
    ].join('\n'),
  quietHint: '  hint: the level is low; raising the capture gain (alsamixer) improves recognition',
  setupPlan: (p, c) =>
    `cc-voice will add to Global in ${p}:\n  "${c}": "voice:pushToTalk"\nOther bindings stay as they are. To go ahead: /dictate setup confirm${c === 'alt+v' ? '' : ` ${c}`}`,
  setupDone: (p, c) => `cc-voice: wrote ${p}; press ${c} in the prompt box to start / stop recording`,
  setupPresent: (p, c) => `cc-voice: ${p} already binds ${c} → voice:pushToTalk; nothing to change`,
  setupConflict: (p, c, a) => `cc-voice: ${c} is already bound to ${a} in ${p}; nothing changed. Pick another: /dictate setup alt+r`,
  setupInvalid: (p, r) => `cc-voice: ${p} is not valid JSON (${r}); nothing changed`,
  noChord: 'no shortcut bound: /dictate setup',
  configTitle: 'cc-voice configuration',
  keyFrom: (w) => `set (${w})`,
  unset: 'not set',
  usage: 'usage: /dictate [retry | cancel | test | config | setup [confirm] [chord]]',
}

function fmt(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function messages(lang: Lang): Messages {
  return lang === 'en' ? en : zh
}
