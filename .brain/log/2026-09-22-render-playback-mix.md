# Offline renderPlaybackMix

`src/audio/renderMix.ts` mixes a `PlaybackMix` plus optional ghost into stereo Float32 (`MixPcm`). `msToSamples` moved from `storage/wav.ts` to `audio/pcm.ts` so audio does not import storage; wav re-exports. Tests in `tests/audio/renderMix.test.ts`. Pan/click/fades not applied. Encode/Review not started.
