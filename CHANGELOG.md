# Changelog

## 0.1.0

- First release. You press a shortcut (`voice:pushToTalk`, bound by `/dictate setup`) or run `/dictate`, speak, and press it again. The transcript is inserted at the cursor; nothing is sent.
- The recorder is `parecord` (PulseAudio/PipeWire) or `arecord` (ALSA), picked automatically or set with `device`.
- Each recording's volume is raised to peak at -3 dB (at most +30 dB) before it is uploaded.
- Transcription works with any OpenAI-compatible `/audio/transcriptions` endpoint. The default is SiliconFlow's SenseVoiceSmall.
- An optional chat-model step (`fix_enabled`) corrects misheard terms. It can share its key with cc-translate.
- `/dictate retry | cancel | test | config | setup`.
- Messages in Chinese and English; README in English, Chinese and Korean.
