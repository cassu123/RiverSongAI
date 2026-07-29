# River Avatar Models

Drop a VRM file here as `river.vrm` and `<RiverAvatar />` will use it. Until
then it falls back to the orb, so the app works with this folder empty.

## Getting a model — no modelling required

Thousands of free, fully-rigged VRM models already exist. Download one:

- **VRoid Hub** — https://hub.vroid.com — filter for downloadable models
- **BOOTH** — https://booth.pm/en/browse/3D%20Models — search "free VRM"
- **VRoid Studio** — https://vroid.com/en/studio — free app, ships with preset
  characters you can export without designing anything

**Check the licence before using one.** VRoid Hub lists per-model terms
(personal use, modification, redistribution) on the model page. Most free
models allow personal use; some do not.

## Using it

Rename the download to `river.vrm` and put it in this folder:

```
frontend/public/models/river.vrm
```

To use a different filename or a remote URL, set:

```
VITE_RIVER_AVATAR_URL=/models/whoever.vrm
```

## What makes a good one

The avatar drives **expressions** and **visemes**, so pick a model with a
proper face rig. Models exported from VRoid Studio always have both. Check
the model has these VRM expression presets:

- `blink` — required, or she never blinks
- `aa`, `ih`, `ou` — required for lip sync
- `neutral`, `relaxed`, `happy`, `sad` — used for mood per conversation state

A model missing some of these still loads; the missing parts just won't
animate.

## Performance

Rendering happens in the browser on whatever device is displaying, not on the
server. A desktop handles a VRM easily. On a Raspberry Pi hub, expect to
either use a low-poly model or keep the orb on those screens.
