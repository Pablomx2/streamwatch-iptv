# streamwatch-iptv

A/B fork of [streamwatch](https://github.com/Pablomx2/streamwatch), swapping its match-based streamed.pk/embed.st backend for [iptv-org/api](https://github.com/iptv-org/api)'s live sports TV channels.

**Live at:** https://pablomx2.github.io/streamwatch-iptv/ (once GitHub Pages is enabled on this repo and this PR is merged)

## What it is

A single static `index.html` — same dark UI, category tabs, search, and player modal as the main streamwatch app, but:

- **Data:** fetches `channels.json` / `streams.json` / `blocklist.json` / `logos.json` directly from `iptv-org.github.io/api` (CORS-open, no backend needed).
- **Content:** 24/7 linear sports channels (ESPN, beIN Sports, regional networks, etc.), not scheduled matches — everything is always shown as live.
- **Categories:** iptv-org has one flat `sports` category; `classify()` re-buckets each channel by name/network keywords into the same category set the main app uses (basketball, football, american-football, hockey, baseball, motor-sports, fight, tennis, rugby, golf, cricket, billiards, afl, darts, other).
- **Playback:** raw `.m3u8` HLS URLs played via a `<video>` element — native HLS on Safari, [hls.js](https://github.com/video-dev/hls.js) (CDN) elsewhere.

## Deploy

GitHub Pages, source = `main` branch, root. No build step, no functions, no `package.json`.

## Optional: CORS proxy for blocked streams

Some sources (notably Pluto TV re-broadcasts, reached via `jmp2.uk`) lock their manifest's `Access-Control-Allow-Origin` to their own domain — a restriction the *browser* enforces (including native `<video>` HLS playback in Safari/WebKit, not just fetch/XHR), so no header trick from a static page can get around it. Without a proxy, `loadStream()` in `index.html` just auto-skips those and plays the next working stream for the channel, if there is one.

To actually unlock them, deploy `cloudflare-worker.js` as a free Cloudflare Worker:

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Create Worker**.
2. Paste the contents of `cloudflare-worker.js` into the editor, replacing the default template.
3. **Deploy**. You'll get a URL like `https://<name>.<your-subdomain>.workers.dev`.
4. In `index.html`, set `const PROXY_BASE = 'https://<name>.<your-subdomain>.workers.dev';` (currently blank).
5. Commit and push — GitHub Pages picks it up automatically.

Free tier is 100k requests/day, no credit card required — plenty for personal use (each stream session uses roughly one request per HLS segment while playing, only for streams that actually needed the proxy).

## Known limitation

Some public IPTV streams require a spoofed `Referer`/`User-Agent` to play; `cloudflare-worker.js` supports passing `&referer=`/`&ua=` query params through to the upstream request if you know what a given source expects, but `index.html` doesn't currently guess or set these automatically.
