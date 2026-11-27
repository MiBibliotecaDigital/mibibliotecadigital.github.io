const APP_ORIGIN_FALLBACK = "https://mibibliotecadigital.github.io";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function corsHeaders(origin, appOrigin) {
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Range, Content-Type",
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag, Last-Modified",
    "Access-Control-Max-Age": "86400"
  });
  if (origin && origin === appOrigin) headers.set("Access-Control-Allow-Origin", appOrigin);
  return headers;
}

function reply(message, status, headers) {
  headers.set("Content-Type", "text/plain; charset=utf-8");
  headers.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(message, { status, headers });
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return { invalid: true };

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
    const length = Math.min(suffix, size);
    return { start: size - length, end: size - 1, length, options: { suffix: length } };
  }

  const start = Number(match[1]);
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
    return { invalid: true };
  }
  end = Math.min(end, size - 1);
  return {
    start,
    end,
    length: end - start + 1,
    options: { offset: start, length: end - start + 1 }
  };
}

export default {
  async fetch(request, env) {
    const appOrigin = env.APP_ORIGIN || APP_ORIGIN_FALLBACK;
    const origin = request.headers.get("Origin");
    const headers = corsHeaders(origin, appOrigin);

    if (origin && origin !== appOrigin) {
      return reply("Origin not allowed", 403, headers);
    }

    if (request.method === "OPTIONS") {
      if (origin !== appOrigin) return reply("Origin not allowed", 403, headers);
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("Allow", "GET, HEAD, OPTIONS");
      return reply("Method not allowed", 405, headers);
    }

    const match = new URL(request.url).pathname.match(/^\/pdf\/([^/]+)$/);
    const documentId = match?.[1] || "";
    if (!UUID_RE.test(documentId)) return reply("Not found", 404, headers);

    const authorization = request.headers.get("Authorization") || "";
    if (!authorization) {
      // Direct navigation to a master document URL sends the visitor to the library.
      // PDF.js requests include Authorization and continue through the checks below.
      const loginUrl = new URL("/", appOrigin);
      loginUrl.searchParams.set("open", documentId);
      headers.set("Location", loginUrl.toString());
      headers.set("Cache-Control", "no-store");
      headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
      return new Response(null, { status: 302, headers });
    }
    if (!/^Bearer\s+\S+$/i.test(authorization)) {
      return reply("Authentication required", 401, headers);
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.BIBLIOTECA) {
      return reply("Gateway is not configured", 503, headers);
    }

    try {
      // The caller's JWT is forwarded to PostgREST. The documents RLS policy
      // decides whether this particular user may see this particular record.
      const query = new URLSearchParams({
        select: "r2_key,mime_type",
        id: `eq.${documentId}`,
        provider: "eq.r2",
        is_published: "eq.true",
        limit: "1"
      });
      const metadataResponse = await fetch(
        `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/documents?${query}`,
        {
          headers: {
            apikey: env.SUPABASE_PUBLISHABLE_KEY,
            Authorization: authorization,
            Accept: "application/json"
          }
        }
      );

      if (metadataResponse.status === 401 || metadataResponse.status === 403) {
        return reply("Authentication or permission check failed", metadataResponse.status, headers);
      }
      if (!metadataResponse.ok) return reply("Authorization service unavailable", 502, headers);

      const rows = await metadataResponse.json();
      const document = Array.isArray(rows) ? rows[0] : null;
      if (!document || typeof document.r2_key !== "string" || !document.r2_key) {
        // Return the same response for missing and unauthorized documents.
        return reply("Document not found", 404, headers);
      }
      if (document.mime_type && document.mime_type !== "application/pdf") {
        return reply("Unsupported document type", 415, headers);
      }

      const metadata = await env.BIBLIOTECA.head(document.r2_key);
      if (!metadata) return reply("Document not found", 404, headers);

      headers.set("Content-Type", "application/pdf");
      headers.set("Content-Disposition", 'inline; filename="document.pdf"');
      headers.set("Accept-Ranges", "bytes");
      headers.set("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
      headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("ETag", metadata.httpEtag);

      if (request.method === "HEAD") {
        headers.set("Content-Length", String(metadata.size));
        if (metadata.uploaded) headers.set("Last-Modified", metadata.uploaded.toUTCString());
        return new Response(null, { status: 200, headers });
      }

      const range = parseRange(request.headers.get("Range"), metadata.size);
      if (range?.invalid) {
        headers.set("Content-Range", `bytes */${metadata.size}`);
        return reply("Requested range is not satisfiable", 416, headers);
      }

      const object = await env.BIBLIOTECA.get(
        document.r2_key,
        range ? { range: range.options } : undefined
      );
      if (!object || !object.body) return reply("Document not found", 404, headers);

      if (object.uploaded) headers.set("Last-Modified", object.uploaded.toUTCString());
      if (range) {
        headers.set("Content-Length", String(range.length));
        headers.set("Content-Range", `bytes ${range.start}-${range.end}/${metadata.size}`);
        return new Response(object.body, { status: 206, headers });
      }

      headers.set("Content-Length", String(metadata.size));
      return new Response(object.body, { status: 200, headers });
    } catch (error) {
      console.error("PDF gateway failure", error);
      return reply("Unable to retrieve document", 502, headers);
    }
  }
};
