# Walkthrough narration clips

Drop one MP3 per step here, named after the step id in `src/features/walkthrough/script.ts`
(for example `fly-arm.mp3`), plus `<chapterId>-intro.mp3` for each chapter intro. When a clip is
missing the browser's speech synthesis reads the step text instead.

Generate the full set from the script with:

    OPENAI_API_KEY=... node scripts/gen-narration.mjs
    # or
    ELEVENLABS_API_KEY=... node scripts/gen-narration.mjs   # defaults to the deep male "Adam" voice
