# Backdrop Picker

Your own images behind the chat in [Hermes Desktop](https://hermes-agent.nousresearch.com/docs/user-guide/desktop).

Hermes ships one faint statue as the chat backdrop, and the Settings toggle only turns it on or off. This plugin lets you swap in any image you want.

> **Community plugin.** Not an official Nous Research product. Works through the public desktop plugin API.

## Features

- **Pick any image**: click **+** or drag files from Finder onto the picker. JPG, PNG, WebP, and animated GIFs all work.
- **Library**: keep several images and click one to switch. Hover to remove.
- **Opacity slider**: 1–100%. The stock statue sits at 2.5%, which makes most photos invisible, so this defaults to 18%.
- **Fill / Fit**: cover the pane or letterbox the whole image.
- **Blend**: Normal, or Invert to get the stock statue's `difference` look.
- **Auto-rotate**: cycle your images every 15 min, hourly, or daily.
- **One-click reset** back to the default statue.

## Use

Press ⌘K, type **backdrop**:

| Command | Does |
| --- | --- |
| Backdrop: Choose image… | Opens the picker |
| Backdrop: Next image | Cycles to the next image |
| Backdrop: Use default statue | Restores the stock backdrop |

Picking an image turns **Settings → Chat Backdrop** on for you, because the backdrop layer only exists while that setting is on.

## Install

```bash
hermes plugins install semirkabir/hermes-backdrop-picker --enable
```

Or copy it in by hand. Put `desktop/plugin.js` at `~/.hermes/desktop-plugins/backdrop-picker/plugin.js`, and the app hot-reloads it within a few seconds.

If you installed it as a package, turn it on under **Settings → Plugins**.

## How it works

It doesn't patch or rebuild the app:

- **One injected `<style>` tag.** It targets the core backdrop layer with `div:has(> img[src*="filler-bg0"])`, hides the statue, and paints your image as that layer's background with your opacity, fit, and blend. It's pure CSS, so it survives re-renders, theme switches, and hot reloads.
- **Images are stored in IndexedDB** as blobs, so they stay on your machine and never upload anywhere.
- **Large photos are downscaled** to 2560px on import so a 12MP photo doesn't sit in memory at full size. GIFs and SVGs are stored as-is.
- **Settings live in `localStorage`**. The app's own toggle is flipped through the supported `host.settings.set('backdrop.v1', true)` API.

## License

MIT
