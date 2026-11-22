# cc-voice

[![test](https://github.com/jzx05/cc-voice/actions/workflows/test.yml/badge.svg)](https://github.com/jzx05/cc-voice/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/jzx05/cc-voice)](LICENSE)

**English** · [简体中文](README.zh-CN.md) · [한국어](README.ko.md)

**Talk to [Claude Code](https://code.claude.com). Your words land in the prompt box.**

cc-voice is a Claude Code plugin for dictation. Press a shortcut and speak, then press it again. The plugin transcribes your speech and inserts the text at the cursor in the prompt box. It does not send anything to Claude: you read the text, fix it if you need to, and press Enter yourself.

```
❯ fix                          press ctrl+x v and say "the login bug in auth.ts"
● Recording 0:03 / 2:00 [ Stop ] [ Cancel ]
❯ fix the login bug in auth.ts                press ctrl+x v again
```

- **Works with any OpenAI-compatible speech-to-text service.** The default is SiliconFlow's `FunAudioLLM/SenseVoiceSmall`: it handles Chinese and English mixed in one sentence, and a few seconds of speech come back in under a second. You can use any service that implements `/audio/transcriptions` instead.
- **Inserts text, never sends it.** The text goes in at the cursor, so you can dictate into the middle of a prompt you are typing. A space is added between two Latin words, never around Chinese.
- **Quiet microphones still work.** Laptop microphones often record very quietly. The plugin raises the volume of each recording, by up to +30 dB, before uploading it.
- **Can fix technical terms (optional).** With `fix_enabled` on, a small chat model corrects misheard terms, for example `优思 effect` → `useEffect`. It can share its key with [cc-translate](https://github.com/jzx05/cc-translate). The two plugins work together: you speak Chinese, and cc-translate sends Claude the English.

Claude Code has its own `/voice` mode, but it needs a claude.ai login. cc-voice works with any login, including an API key or a third-party `ANTHROPIC_BASE_URL`.

## Requirements

- Linux. macOS and Windows are not supported yet.
- `curl`, `sh` and `base64`. Most systems already have them.
- A recorder: `parecord` (pulseaudio-utils, which also works with PipeWire) or `arecord` (alsa-utils).
- Claude Code with the hooks-module API. Tested on 2.1.330.

## Install

```
/plugin install cc-voice --marketplace jzx05/cc-voice
```

Then bind the shortcut. Run this once and it shows you what it will add:

```
/dictate setup            # shows the change to ~/.claude/keybindings.json
/dictate setup confirm    # writes it: ctrl+x v → voice:pushToTalk, in Global
```

To use a different key, add it after the command: `/dictate setup confirm alt+shift+r`. If the key is already bound to something else, the plugin tells you and leaves the file unchanged. You can also add the binding yourself:

```json
{ "bindings": [ { "context": "Global", "bindings": { "ctrl+x v": "voice:pushToTalk" } } ] }
```

`ctrl+x v` is a chord: press ctrl+x, let go, then press v. The binding has to be in `Global`. Claude Code does not pass a `Chat` binding on to a plugin's button. If you also use Claude Code's own voice mode, it handles this key while that mode is on.

## Setup

Set the transcriber's API key, either in the plugin options or as an environment variable:

```
/plugin configure cc-voice@cc-voice
```

```bash
export CC_VOICE_API_KEY="sk-..."    # used when asr_api_key is empty
```

Then run `/dictate test`. It records for 3 seconds, reports the microphone level, and shows what it heard.

| Option | Default | What it does |
|---|---|---|
| `asr_base_url` | `https://api.siliconflow.cn/v1` | OpenAI-compatible endpoint: the part before `/audio/transcriptions`. |
| `asr_model` | `FunAudioLLM/SenseVoiceSmall` | Speech-to-text model. |
| `asr_api_key` | (empty) | Kept in your system's secure storage. If empty, `CC_VOICE_API_KEY` is used. |
| `language` | `auto` | `auto`, or a language code such as `zh` or `en`. The plugin's own messages are in Chinese for `auto` and `zh`, and in English for any other language. |
| `hotwords` | (empty) | Terms you say often, separated by commas. They are sent to the transcriber as a hint, and to the fix step. |
| `device` | `auto` | `auto` uses a real PulseAudio/PipeWire input if there is one, and the first ALSA capture device otherwise. You can also set `pulse`, `pulse:<source>`, or an ALSA device such as `plughw:0,7`. |
| `max_seconds` | `120` | A recording stops and is transcribed after this many seconds. |
| `fix_enabled` | `false` | Send each transcript to a chat model that fixes terms and punctuation. Adds about 0.5 to 1 s. |
| `fix_base_url` | `https://api.deepseek.com` | OpenAI-compatible endpoint for the fix step. |
| `fix_model` | `deepseek-flash` | Chat model for the fix step. |
| `fix_api_key` | (empty) | If empty, `CC_VOICE_FIX_API_KEY` is used, then `CC_TRANSLATE_API_KEY`. |
| `fix_extra_body` | `{"thinking":{"type":"disabled"}}` | JSON merged into every fix request. Set it to `{}` for providers that reject unknown fields. |

### Other transcribers

| Provider | `asr_base_url` | `asr_model` |
|---|---|---|
| SiliconFlow (tested) | `https://api.siliconflow.cn/v1` | `FunAudioLLM/SenseVoiceSmall` |
| Groq | `https://api.groq.com/openai/v1` | `whisper-large-v3-turbo` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini-transcribe` |

## Commands

| Command | What it does |
|---|---|
| your shortcut, or `/dictate` | Start recording. Press it again to stop and transcribe. |
| `/dictate cancel` | Stop and throw the recording away. The band's Cancel button does the same. |
| `/dictate retry` | Transcribe the last recording again, for example after a network error. |
| `/dictate test` | Record for 3 seconds and report the level, the gain applied and what was heard. Nothing is inserted. |
| `/dictate config` | Show the settings in force. API keys are never shown. |
| `/dictate setup [confirm] [key]` | Bind the shortcut, as described above. |

## When something goes wrong

The prompt box is only changed when the plugin has text to insert. In every other case a toast tells you what happened:

- Microphone busy: another program or session is recording.
- No recorder installed.
- The API key is missing. The plugin checks this before it starts recording, so you don't speak for nothing.
- The request failed. Run `/dictate retry` to try the same recording again.
- No speech was recognised, or the recording was too short.

If a dialog is open and the prompt box cannot take the text, the transcript is shown in the conversation so that it is not lost.

## Privacy

Your recording is uploaded to the transcriber you configured, and only there. If `fix_enabled` is on, the transcript (text only) also goes to the fix endpoint.

The last recording is kept at `$TMPDIR/cc-voice/<session>.raw` (with its `.wav`) so `/dictate retry` can use it. The next recording overwrites it. A cancelled recording can't be retried.

The API key goes to `curl` on standard input. It never appears on the command line.

## Development

```bash
git clone https://github.com/jzx05/cc-voice
claude --plugin-dir ./cc-voice      # run it from the folder
claude plugin test ./cc-voice       # run the tests
claude plugin validate ./cc-voice
```

- `hooks/register.tsx`: hooks, the band and the record / transcribe flow.
- `hooks/recorder.ts`: choosing the recorder and its arguments.
- `hooks/audio.ts`: levels, normalisation, WAV.
- `hooks/service.ts`: transcription (curl multipart) and the fix step.
- `hooks/keybindings.ts`: merging the shortcut into keybindings.json.
- `hooks/text.ts` and `hooks/i18n.ts`: text rules and messages.

## License

[MIT](LICENSE)
