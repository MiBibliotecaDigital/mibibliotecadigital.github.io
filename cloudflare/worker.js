const APP_ORIGIN_FALLBACK = "https://mibibliotecadigital.github.io";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function corsHeaders(origin, appOrigin) {
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Range, Content-Type, X-File-Size",
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


const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const PART_SIZE = 10 * 1024 * 1024;
const UPLOAD_KEY_RE = /^library\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i;

function jsonReply(value, status, headers) {
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(value), { status, headers });
}

async function requireAdmin(request, env, headers) {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return { response: reply("Authentication required", 401, headers) };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.BIBLIOTECA) {
    return { response: reply("Gateway is not configured", 503, headers) };
  }
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const authResponse = await fetch(base + "/auth/v1/user", {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: authorization }
  });
  if (!authResponse.ok) {
    return { response: reply("Authentication required", 401, headers) };
  }
  const user = await authResponse.json();
  if (!user?.id || !UUID_RE.test(user.id)) {
    return { response: reply("Authentication required", 401, headers) };
  }
  const profileQuery = new URLSearchParams({
    select: "role,status",
    id: "eq." + user.id,
    limit: "1"
  });
  const profileResponse = await fetch(base + "/rest/v1/profiles?" + profileQuery, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: authorization,
      Accept: "application/json"
    }
  });
  if (!profileResponse.ok) {
    return { response: reply("Authorization service unavailable", 502, headers) };
  }
  const profiles = await profileResponse.json();
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile || profile.status !== "active" || profile.role !== "admin") {
    return { response: reply("Administrator permission required", 403, headers) };
  }
  return { user, authorization };
}

function validUploadKey(key) {
  return typeof key === "string" && UPLOAD_KEY_RE.test(key);
}

function normalizeDocumentMetadata(input) {
  if (!input || typeof input !== "object") return null;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const authorsText = typeof input.authors === "string" ? input.authors : "";
  const authors = authorsText.split(",").map(x => x.trim()).filter(Boolean).slice(0, 20);
  const category = typeof input.category === "string" ? input.category.trim() : "General";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  const collectionId = input.collectionId || null;
  const yearText = input.publicationYear === "" || input.publicationYear == null ? null : String(input.publicationYear);
  const year = yearText === null ? null : Number(yearText);
  if (!title || title.length > 300 || authorsText.length > 1000 ||
      category.length > 100 || description.length > 3000) return null;
  if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 2100)) return null;
  if (collectionId !== null && !UUID_RE.test(collectionId)) return null;
  return {
    title,
    authors,
    publication_year: year,
    category: category || "General",
    description,
    collection_id: collectionId
  };
}

async function uploadStart(request, env, headers) {
  const auth = await requireAdmin(request, env, headers);
  if (auth.response) return auth.response;
  const fileSize = Number(request.headers.get("X-File-Size"));
  if (!Number.isSafeInteger(fileSize) || fileSize < 100 || fileSize > MAX_FILE_SIZE) {
    return reply("Invalid file size. Maximum supported size is 2 GiB.", 413, headers);
  }
  const key = "library/" + crypto.randomUUID() + ".pdf";
  try {
    const upload = await env.BIBLIOTECA.createMultipartUpload(key, {
      httpMetadata: { contentType: "application/pdf", cacheControl: "private, no-store" },
      customMetadata: { expectedSize: String(fileSize), uploadedBy: auth.user.id }
    });
    return jsonReply({ key: upload.key, uploadId: upload.uploadId, partSize: PART_SIZE }, 201, headers);
  } catch (error) {
    console.error("R2 multipart start failed", error);
    return reply("Could not start the upload.", 502, headers);
  }
}

async function uploadPart(request, env, headers) {
  const auth = await requireAdmin(request, env, headers);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const uploadId = url.searchParams.get("uploadId");
  const partNumber = Number(url.searchParams.get("partNumber"));
  if (!validUploadKey(key) || !uploadId || uploadId.length > 512 ||
      !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000 || !request.body) {
    return reply("Invalid upload part request.", 400, headers);
  }
  const declaredSize = Number(request.headers.get("Content-Length") || 0);
  if (declaredSize > PART_SIZE || declaredSize < 0) {
    return reply("Upload part exceeds the 10 MiB limit.", 413, headers);
  }
  try {
    const multipart = env.BIBLIOTECA.resumeMultipartUpload(key, uploadId);
    let uploaded;
    if (partNumber === 1 || declaredSize === 0) {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > PART_SIZE) {
        return reply("Invalid upload part size.", 413, headers);
      }
      if (partNumber === 1 &&
          (bytes.byteLength < 5 || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")) {
        return reply("The selected file is not a valid PDF.", 415, headers);
      }
      uploaded = await multipart.uploadPart(partNumber, bytes);
    } else {
      uploaded = await multipart.uploadPart(partNumber, request.body);
    }
    return jsonReply({ partNumber: uploaded.partNumber, etag: uploaded.etag }, 200, headers);
  } catch (error) {
    console.error("R2 multipart part failed", error);
    return reply("Could not upload this part. You can retry it.", 502, headers);
  }
}

async function uploadComplete(request, env, headers) {
  const auth = await requireAdmin(request, env, headers);
  if (auth.response) return auth.response;
  let body;
  try { body = await request.json(); }
  catch { return reply("Invalid completion data.", 400, headers); }
  const { key, uploadId, parts, fileSize } = body || {};
  const metadata = normalizeDocumentMetadata(body?.metadata);
  if (!validUploadKey(key) || typeof uploadId !== "string" || !uploadId ||
      uploadId.length > 512 || !metadata || !Array.isArray(parts) ||
      parts.length < 1 || parts.length > 10000 ||
      !Number.isSafeInteger(fileSize) || fileSize < 100 || fileSize > MAX_FILE_SIZE) {
    return reply("Invalid upload completion data.", 400, headers);
  }
  const normalizedParts = [...parts].sort((a, b) => Number(a.partNumber) - Number(b.partNumber));
  for (let i = 0; i < normalizedParts.length; i++) {
    const part = normalizedParts[i];
    if (part.partNumber !== i + 1 || typeof part.etag !== "string" ||
        !part.etag || part.etag.length > 256) {
      return reply("The uploaded parts are incomplete or invalid.", 400, headers);
    }
  }
  let object;
  try {
    const multipart = env.BIBLIOTECA.resumeMultipartUpload(key, uploadId);
    object = await multipart.complete(normalizedParts);
  } catch (error) {
    console.error("R2 multipart completion failed", error);
    return reply("The PDF could not be assembled. Retry the upload.", 400, headers);
  }
  if (object.size !== fileSize ||
      object.customMetadata?.expectedSize !== String(fileSize) ||
      object.customMetadata?.uploadedBy !== auth.user.id) {
    await env.BIBLIOTECA.delete(key);
    return reply("The uploaded file failed its integrity check.", 400, headers);
  }

  const document = {
    ...metadata,
    provider: "r2",
    r2_key: key,
    mime_type: "application/pdf",
    size_bytes: object.size,
    is_demo: false,
    is_published: true
  };
  const insertResponse = await fetch(
    env.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/documents",
    {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: auth.authorization,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(document)
    }
  );
  if (!insertResponse.ok) {
    const errorText = await insertResponse.text();
    console.error("Document catalogue insert failed", insertResponse.status, errorText);
    await env.BIBLIOTECA.delete(key);
    return reply("The PDF was uploaded but could not be added to the catalogue. The file has been rolled back.", 502, headers);
  }
  const rows = await insertResponse.json();
  return jsonReply({ ok: true, document: Array.isArray(rows) ? rows[0] : null }, 201, headers);
}

async function uploadAbort(request, env, headers) {
  const auth = await requireAdmin(request, env, headers);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const uploadId = url.searchParams.get("uploadId");
  if (!validUploadKey(key) || !uploadId || uploadId.length > 512) {
    return reply("Invalid upload abort request.", 400, headers);
  }
  try {
    await env.BIBLIOTECA.resumeMultipartUpload(key, uploadId).abort();
    return new Response(null, { status: 204, headers });
  } catch (error) {
    console.error("R2 multipart abort failed", error);
    return reply("Could not abort this upload.", 400, headers);
  }
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

    const pathname = new URL(request.url).pathname;
    if (pathname === "/upload/start" && request.method === "POST") return uploadStart(request, env, headers);
    if (pathname === "/upload/part" && request.method === "PUT") return uploadPart(request, env, headers);
    if (pathname === "/upload/complete" && request.method === "POST") return uploadComplete(request, env, headers);
    if (pathname === "/upload/abort" && request.method === "DELETE") return uploadAbort(request, env, headers);

    if (request.method !== "GET" && request.method !== "HEAD") {
      headers.set("Allow", "GET, HEAD, POST, PUT, DELETE, OPTIONS");
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
