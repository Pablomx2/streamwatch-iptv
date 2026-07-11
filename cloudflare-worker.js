// StreamWatch IPTV — CORS-unlocking HLS proxy for Cloudflare Workers.
//
// Some IPTV sources (e.g. Pluto TV re-broadcasts, reached via jmp2.uk) lock
// their manifest's Access-Control-Allow-Origin to their own domain, which is
// enforced by the browser (including native <video> HLS playback in
// WebKit/Safari, not just hls.js/XHR) — so index.html can never play them
// directly, no matter what headers it sends, because a page can't override
// what origin the browser reports itself as.
//
// This Worker runs server-side (no browser, no CORS enforcement), fetches the
// manifest and every URL it references, and re-serves everything with an open
// Access-Control-Allow-Origin. It rewrites every URI inside an HLS manifest
// (variant playlists, segments, encryption keys, fMP4 init segments, alt
// audio/subtitle tracks) to route back through itself — otherwise only the
// master playlist would be proxied and the browser would still fetch segments
// directly, hitting the same CORS wall one level down.
//
// Deploy: paste this file into a new Worker in the Cloudflare dashboard
// (workers.cloudflare.com → Create → paste → Deploy), or `wrangler deploy`.
// No environment variables or KV needed. Copy the resulting
// https://<name>.<subdomain>.workers.dev URL into PROXY_BASE in index.html.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const reqUrl = new URL(request.url);
    if (reqUrl.pathname !== '/proxy') {
      return new Response('Not found. Use /proxy?url=<encoded stream url>', { status: 404 });
    }

    const target = reqUrl.searchParams.get('url');
    if (!target) return new Response('Missing url param', { status: 400 });

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response('Invalid url param', { status: 400 });
    }

    // Optional per-stream overrides for sources that require a spoofed
    // Referer/User-Agent to authorize playback (a separate problem from CORS —
    // see the README's "Known gap" note).
    const referer = reqUrl.searchParams.get('referer');
    const userAgent = reqUrl.searchParams.get('ua');
    const upstreamHeaders = {};
    if (referer) upstreamHeaders['Referer'] = referer;
    if (userAgent) upstreamHeaders['User-Agent'] = userAgent;

    const upstream = await fetch(targetUrl.toString(), { headers: upstreamHeaders });
    const contentType = upstream.headers.get('content-type') || '';
    const isManifest = /mpegurl|m3u8/i.test(contentType) || targetUrl.pathname.endsWith('.m3u8');

    if (isManifest) {
      const text = await upstream.text();
      const rewritten = rewriteManifest(text, targetUrl, reqUrl.origin, referer, userAgent);
      return new Response(rewritten, {
        status: upstream.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // Segments, encryption keys, init segments: stream through unmodified.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': contentType || 'application/octet-stream',
        'Cache-Control': upstream.headers.get('cache-control') || 'public, max-age=6',
      },
    });
  },
};

function proxify(absoluteUrl, workerOrigin, referer, userAgent) {
  const p = new URL(workerOrigin + '/proxy');
  p.searchParams.set('url', absoluteUrl);
  if (referer) p.searchParams.set('referer', referer);
  if (userAgent) p.searchParams.set('ua', userAgent);
  return p.toString();
}

function rewriteManifest(text, manifestUrl, workerOrigin, referer, userAgent) {
  const attrUriRe = /URI="([^"]+)"/g;

  return text.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      // Tag lines that carry a URI in an attribute: #EXT-X-KEY, #EXT-X-MAP,
      // #EXT-X-MEDIA (alt audio/subtitle tracks), etc.
      if (trimmed.includes('URI="')) {
        return line.replace(attrUriRe, (_, uri) => {
          const abs = new URL(uri, manifestUrl).toString();
          return `URI="${proxify(abs, workerOrigin, referer, userAgent)}"`;
        });
      }
      return line;
    }

    // A bare URI line: a variant playlist (master) or a segment (media playlist).
    const abs = new URL(trimmed, manifestUrl).toString();
    return proxify(abs, workerOrigin, referer, userAgent);
  }).join('\n');
}
