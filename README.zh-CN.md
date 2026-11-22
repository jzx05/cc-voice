# cc-voice

[![test](https://github.com/jzx05/cc-voice/actions/workflows/test.yml/badge.svg)](https://github.com/jzx05/cc-voice/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/jzx05/cc-voice)](LICENSE)

[English](README.md) · **简体中文** · [한국어](README.ko.md)

**对着 [Claude Code](https://code.claude.com) 说话，文字直接出现在输入框里。**

cc-voice 是一个 Claude Code 语音输入插件。按一下快捷键开始说话，再按一下结束。插件会把这段语音转成文字，插到输入框的光标处。它不会替你发送：你看一遍，有错就改，再自己按 Enter。

```
❯ 修一下                      按 ctrl+x v，说「auth.ts 里登录的 bug」
● 录音中 0:03 / 2:00 [ 停止 ] [ 取消 ]
❯ 修一下auth.ts 里登录的 bug          再按一次 ctrl+x v
```

- **支持任何 OpenAI 兼容的语音识别服务。** 默认用硅基流动的 `FunAudioLLM/SenseVoiceSmall`：一句话里中英文混着说也能识别，几秒钟的语音不到一秒就转写好。也可以换成任何提供 `/audio/transcriptions` 接口的服务。
- **只插入，不发送。** 文字插在光标处，所以打字打到一半也可以接着说。两个英文单词之间会自动补空格，中文前后不加。
- **麦克风声音小也能用。** 笔记本自带的麦克风录音往往很小声。插件上传前会自动放大每段录音的音量，最多放大 30 dB。
- **可以修正技术术语（可选）。** 打开 `fix_enabled` 后，会用一个小的对话模型修正听错的术语，比如把 `优思 effect` 改成 `useEffect`。它可以和 [cc-translate](https://github.com/jzx05/cc-translate) 共用 API key。两个插件可以一起用：你说中文，cc-translate 再把它翻成英文发给 Claude。

Claude Code 自己也有 `/voice` 语音模式，但必须用 claude.ai 账号登录才能用。cc-voice 不挑登录方式，用 API key 或者第三方 `ANTHROPIC_BASE_URL` 都可以。

## 运行要求

- Linux。macOS 和 Windows 暂不支持。
- `curl`、`sh` 和 `base64`，一般系统都自带。
- 录音程序：`parecord`（pulseaudio-utils，PipeWire 下也能用）或 `arecord`（alsa-utils）。
- 支持 hooks 模块 API 的 Claude Code，已在 2.1.330 上测试。

## 安装

```
/plugin install cc-voice --marketplace jzx05/cc-voice
```

然后绑定快捷键。运行下面的命令，它会先告诉你要改什么：

```
/dictate setup            # 显示要往 ~/.claude/keybindings.json 里加什么
/dictate setup confirm    # 写入：在 Global 里加上 ctrl+x v → voice:pushToTalk
```

想换别的键，就加在命令后面：`/dictate setup confirm alt+shift+r`。如果这个键已经绑了别的功能，插件会告诉你，文件不会改动。也可以自己手动加：

```json
{ "bindings": [ { "context": "Global", "bindings": { "ctrl+x v": "voice:pushToTalk" } } ] }
```

`ctrl+x v` 是组合键：先按 ctrl+x，松开，再按 v。绑定必须写在 `Global` 里，写在 `Chat` 里的绑定 Claude Code 不会传给插件的按钮。如果你同时在用 Claude Code 自带的语音模式，那个模式开着的时候，这个键会归它处理。

## 配置

在插件选项里或者用环境变量设置语音识别服务的 API key：

```
/plugin configure cc-voice@cc-voice
```

```bash
export CC_VOICE_API_KEY="sk-..."    # asr_api_key 没填时用这个
```

然后运行 `/dictate test`：它会录 3 秒，报告麦克风音量，并显示识别出的文字。

| 选项 | 默认值 | 说明 |
|---|---|---|
| `asr_base_url` | `https://api.siliconflow.cn/v1` | OpenAI 兼容接口地址，填 `/audio/transcriptions` 前面的部分。 |
| `asr_model` | `FunAudioLLM/SenseVoiceSmall` | 语音识别模型。 |
| `asr_api_key` | （空） | 保存在系统的安全存储里。不填时用 `CC_VOICE_API_KEY`。 |
| `language` | `auto` | `auto`，或者 `zh`、`en` 这样的语言代码。`auto` 和 `zh` 时插件自己的提示是中文，设成其他语言时是英文。 |
| `hotwords` | （空） | 常说的术语，用逗号分隔。会作为提示传给识别服务，也会交给修正步骤。 |
| `device` | `auto` | `auto` 时，有真实的 PulseAudio/PipeWire 输入就用它，没有就用第一个 ALSA 录音设备。也可以设成 `pulse`、`pulse:<source>`，或者 `plughw:0,7` 这样的 ALSA 设备。 |
| `max_seconds` | `120` | 录到这么多秒会自动停止并转写。 |
| `fix_enabled` | `false` | 把每段识别结果交给对话模型修正术语和标点，大约多花 0.5–1 秒。 |
| `fix_base_url` | `https://api.deepseek.com` | 修正步骤用的 OpenAI 兼容接口。 |
| `fix_model` | `deepseek-flash` | 修正步骤用的对话模型。 |
| `fix_api_key` | （空） | 不填时依次用 `CC_VOICE_FIX_API_KEY`、`CC_TRANSLATE_API_KEY`。 |
| `fix_extra_body` | `{"thinking":{"type":"disabled"}}` | 合并进每次修正请求的 JSON。如果服务不接受未知字段，就设成 `{}`。 |

### 其他语音识别服务

| 服务 | `asr_base_url` | `asr_model` |
|---|---|---|
| 硅基流动（已测试） | `https://api.siliconflow.cn/v1` | `FunAudioLLM/SenseVoiceSmall` |
| Groq | `https://api.groq.com/openai/v1` | `whisper-large-v3-turbo` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini-transcribe` |

## 命令

| 命令 | 作用 |
|---|---|
| 你绑定的快捷键，或 `/dictate` | 开始录音；再按一次停止并转写。 |
| `/dictate cancel` | 停止并丢掉这段录音。band 上的「取消」按钮效果一样。 |
| `/dictate retry` | 把上一段录音重新转写一次，比如网络出错之后。 |
| `/dictate test` | 录 3 秒，报告音量、放大了多少，以及识别出的文字。不会插入输入框。 |
| `/dictate config` | 显示当前生效的配置。API key 永远不会显示出来。 |
| `/dictate setup [confirm] [键]` | 绑定快捷键，用法见上文。 |

## 出错时

只有拿到要插入的文字时，插件才会改动输入框。其他情况都会弹出提示告诉你发生了什么：

- 麦克风被占用：另一个程序或会话正在录音。
- 没有安装录音程序。
- 没有设置 API key。插件在开始录音之前就会检查，不会让你白说一遍。
- 请求失败。运行 `/dictate retry` 可以用同一段录音再试一次。
- 没有识别出文字，或者录音太短。

如果有对话框挡着、输入框暂时不能输入，识别结果会显示在会话里，不会丢。

## 隐私

录音只会上传到你配置的语音识别服务。如果打开了 `fix_enabled`，识别出的文字（只有文字）还会发给修正服务。

最近一段录音保存在 `$TMPDIR/cc-voice/<会话>.raw`（还有同名的 `.wav`），供 `/dictate retry` 使用，下次录音时会被覆盖。取消掉的录音不能重新转写。

API key 通过标准输入交给 `curl`，不会出现在命令行里。

## 开发

```bash
git clone https://github.com/jzx05/cc-voice
claude --plugin-dir ./cc-voice      # 直接从目录运行
claude plugin test ./cc-voice       # 运行测试
claude plugin validate ./cc-voice
```

- `hooks/register.tsx`：hooks、band，以及录音和转写的流程。
- `hooks/recorder.ts`：选择录音程序和它的参数。
- `hooks/audio.ts`：音量计算、放大、WAV。
- `hooks/service.ts`：语音识别（用 curl 上传 multipart）和修正步骤。
- `hooks/keybindings.ts`：把快捷键合并进 keybindings.json。
- `hooks/text.ts` 和 `hooks/i18n.ts`：文本规则和提示文案。

## 许可证

[MIT](LICENSE)
