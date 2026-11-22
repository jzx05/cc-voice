# cc-voice

[![test](https://github.com/jzx05/cc-voice/actions/workflows/test.yml/badge.svg)](https://github.com/jzx05/cc-voice/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/jzx05/cc-voice)](LICENSE)

[English](README.md) · [简体中文](README.zh-CN.md) · **한국어**

**[Claude Code](https://code.claude.com)에 말로 입력하세요. 말한 내용이 입력창에 바로 들어갑니다.**

cc-voice는 Claude Code용 음성 입력 플러그인입니다. 단축키를 누르고 말한 다음, 한 번 더 누르면 끝납니다. 플러그인이 음성을 텍스트로 바꿔 입력창의 커서 위치에 넣어 줍니다. 대신 전송하지는 않습니다. 텍스트를 확인하고 필요하면 고친 뒤 직접 Enter를 누르세요.

```
❯ fix                          ctrl+x v를 누르고 "the login bug in auth.ts"라고 말하기
● Recording 0:03 / 2:00 [ Stop ] [ Cancel ]
❯ fix the login bug in auth.ts                ctrl+x v를 한 번 더
```

- **OpenAI 호환 음성 인식 서비스라면 무엇이든 쓸 수 있습니다.** 기본값은 SiliconFlow의 `FunAudioLLM/SenseVoiceSmall`입니다. 한국어, 중국어, 영어 등을 인식하고, 몇 초 분량의 음성은 1초 안에 텍스트로 돌아옵니다. `/audio/transcriptions`를 지원하는 다른 서비스로 바꿀 수도 있습니다.
- **넣기만 하고 보내지 않습니다.** 텍스트는 커서 위치에 들어가므로 입력하던 프롬프트 중간에도 이어서 말할 수 있습니다. 영어 단어와 영어 단어 사이에는 공백이 자동으로 들어갑니다.
- **마이크 소리가 작아도 됩니다.** 노트북 내장 마이크는 소리가 아주 작게 녹음되는 경우가 많습니다. 플러그인이 업로드 전에 녹음마다 볼륨을 키웁니다(최대 +30 dB).
- **기술 용어를 고칠 수 있습니다(선택).** `fix_enabled`를 켜면 작은 채팅 모델이 잘못 들린 용어를 고칩니다. [cc-translate](https://github.com/jzx05/cc-translate)와 API 키를 같이 쓸 수 있습니다. 두 플러그인을 함께 쓰면 한국어로 말해도 Claude에게는 영어로 전달됩니다.

Claude Code에도 자체 `/voice` 모드가 있지만 claude.ai 로그인이 있어야 합니다. cc-voice는 로그인 방식과 상관없이 동작합니다. API 키나 서드파티 `ANTHROPIC_BASE_URL`로 써도 됩니다.

## 요구 사항

- Linux. macOS와 Windows는 아직 지원하지 않습니다.
- `curl`, `sh`, `base64`. 대부분의 시스템에 이미 있습니다.
- 녹음 프로그램: `parecord`(pulseaudio-utils, PipeWire에서도 동작) 또는 `arecord`(alsa-utils).
- hooks 모듈 API를 지원하는 Claude Code. 2.1.330에서 테스트했습니다.

## 설치

```
/plugin install cc-voice --marketplace jzx05/cc-voice
```

그다음 단축키를 연결합니다. 아래 명령을 한 번 실행하면 무엇을 추가할지 먼저 보여 줍니다.

```
/dictate setup            # ~/.claude/keybindings.json에 추가할 내용을 보여 줌
/dictate setup confirm    # 기록: Global에 ctrl+x v → voice:pushToTalk
```

다른 키를 쓰려면 명령 뒤에 붙이세요: `/dictate setup confirm alt+shift+r`. 그 키가 이미 다른 기능에 연결되어 있으면 플러그인이 알려 주고 파일은 바꾸지 않습니다. 직접 추가해도 됩니다.

```json
{ "bindings": [ { "context": "Global", "bindings": { "ctrl+x v": "voice:pushToTalk" } } ] }
```

`ctrl+x v`는 연속 키입니다. ctrl+x를 눌렀다 떼고 v를 누르세요. 바인딩은 반드시 `Global`에 있어야 합니다. Claude Code는 `Chat`에 있는 바인딩을 플러그인 버튼에 전달하지 않습니다. Claude Code 자체 음성 모드도 쓰고 있다면, 그 모드가 켜져 있는 동안에는 이 키를 그 모드가 처리합니다.

## 설정

음성 인식 서비스의 API 키를 플러그인 옵션이나 환경 변수로 설정하세요.

```
/plugin configure cc-voice@cc-voice
```

```bash
export CC_VOICE_API_KEY="sk-..."    # asr_api_key가 비어 있을 때 사용
```

그다음 `/dictate test`를 실행하세요. 3초 동안 녹음하고 마이크 음량과 인식된 텍스트를 보여 줍니다. 한국어로 말한다면 `language`를 `ko`로 설정하세요. 중국어가 아닌 언어로 설정하면 플러그인 메시지는 영어로 나옵니다.

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `asr_base_url` | `https://api.siliconflow.cn/v1` | OpenAI 호환 엔드포인트. `/audio/transcriptions` 앞부분입니다. |
| `asr_model` | `FunAudioLLM/SenseVoiceSmall` | 음성 인식 모델. |
| `asr_api_key` | (비어 있음) | 시스템 보안 저장소에 보관됩니다. 비어 있으면 `CC_VOICE_API_KEY`를 사용합니다. |
| `language` | `auto` | `auto` 또는 `ko`, `zh`, `en` 같은 언어 코드. 플러그인 메시지는 `auto`와 `zh`일 때 중국어, 그 밖의 언어일 때 영어입니다. |
| `hotwords` | (비어 있음) | 자주 말하는 용어를 쉼표로 구분해 적습니다. 인식 서비스에 힌트로 보내고, 수정 단계에도 전달합니다. |
| `device` | `auto` | `auto`는 실제 PulseAudio/PipeWire 입력이 있으면 그것을, 없으면 첫 번째 ALSA 녹음 장치를 씁니다. `pulse`, `pulse:<source>`, 또는 `plughw:0,7` 같은 ALSA 장치를 지정할 수도 있습니다. |
| `max_seconds` | `120` | 이 시간(초)이 지나면 녹음이 멈추고 텍스트로 변환됩니다. |
| `fix_enabled` | `false` | 인식 결과를 채팅 모델에 보내 용어와 문장 부호를 고칩니다. 약 0.5~1초가 더 걸립니다. |
| `fix_base_url` | `https://api.deepseek.com` | 수정 단계의 OpenAI 호환 엔드포인트. |
| `fix_model` | `deepseek-flash` | 수정 단계의 채팅 모델. |
| `fix_api_key` | (비어 있음) | 비어 있으면 `CC_VOICE_FIX_API_KEY`, 그다음 `CC_TRANSLATE_API_KEY`를 사용합니다. |
| `fix_extra_body` | `{"thinking":{"type":"disabled"}}` | 모든 수정 요청에 병합되는 JSON. 알 수 없는 필드를 거부하는 서비스에서는 `{}`로 설정하세요. |

### 다른 음성 인식 서비스

| 서비스 | `asr_base_url` | `asr_model` |
|---|---|---|
| SiliconFlow (테스트됨) | `https://api.siliconflow.cn/v1` | `FunAudioLLM/SenseVoiceSmall` |
| Groq | `https://api.groq.com/openai/v1` | `whisper-large-v3-turbo` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini-transcribe` |

## 명령

| 명령 | 동작 |
|---|---|
| 연결한 단축키, 또는 `/dictate` | 녹음을 시작합니다. 한 번 더 누르면 멈추고 텍스트로 변환합니다. |
| `/dictate cancel` | 멈추고 녹음을 버립니다. band의 Cancel 버튼도 같습니다. |
| `/dictate retry` | 마지막 녹음을 다시 변환합니다. 네트워크 오류가 났을 때 등에 씁니다. |
| `/dictate test` | 3초 동안 녹음하고 음량, 적용한 증폭, 인식 결과를 보여 줍니다. 입력창에는 넣지 않습니다. |
| `/dictate config` | 현재 적용 중인 설정을 보여 줍니다. API 키는 절대 표시하지 않습니다. |
| `/dictate setup [confirm] [키]` | 단축키를 연결합니다. 사용법은 위를 참고하세요. |

## 문제가 생기면

플러그인은 넣을 텍스트가 있을 때만 입력창을 바꿉니다. 그 밖의 경우에는 알림으로 무슨 일이 있었는지 알려 줍니다.

- 마이크 사용 중: 다른 프로그램이나 세션이 녹음하고 있습니다.
- 녹음 프로그램이 설치되어 있지 않습니다.
- API 키가 없습니다. 녹음을 시작하기 전에 확인하므로 말한 것이 헛되지 않습니다.
- 요청 실패. `/dictate retry`로 같은 녹음을 다시 시도할 수 있습니다.
- 인식된 말이 없거나 녹음이 너무 짧습니다.

대화 상자가 열려 있어 입력창에 넣을 수 없으면 인식 결과를 대화에 표시하므로 잃어버리지 않습니다.

## 개인 정보

녹음은 설정한 음성 인식 서비스로만 업로드됩니다. `fix_enabled`가 켜져 있으면 인식된 텍스트(텍스트만)가 수정 엔드포인트로도 전송됩니다.

마지막 녹음은 `/dictate retry`를 위해 `$TMPDIR/cc-voice/<세션>.raw`(와 같은 이름의 `.wav`)에 남고, 다음 녹음이 덮어씁니다. 취소한 녹음은 다시 변환할 수 없습니다.

API 키는 표준 입력으로 `curl`에 전달되며 명령줄에는 나타나지 않습니다.

## 개발

```bash
git clone https://github.com/jzx05/cc-voice
claude --plugin-dir ./cc-voice      # 폴더에서 바로 실행
claude plugin test ./cc-voice       # 테스트 실행
claude plugin validate ./cc-voice
```

## 라이선스

[MIT](LICENSE)
