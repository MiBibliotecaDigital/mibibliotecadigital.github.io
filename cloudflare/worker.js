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

function titleFromFilename(fileName) {
  const base = String(fileName || "").split(/[\\/]/).pop().replace(/\.pdf$/i, "");
  return base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) || "Documento sin título";
}

function normalizeDocumentMetadata(input, fallbackTitle) {
  input = input && typeof input === "object" ? input : {};
  const title = (typeof input.title === "string" ? input.title.trim() : "") || fallbackTitle;
  const authorsText = typeof input.authors === "string" ? input.authors : "";
  const authors = Array.isArray(input.authors) ? input.authors.map(x => String(x).trim()).filter(Boolean).slice(0, 20) :
    authorsText.split(",").map(x => x.trim()).filter(Boolean).slice(0, 20);
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
  let body;
  try { body = await request.json(); } catch { return reply("Invalid upload start data.", 400, headers); }
  const fileSize = Number(body?.fileSize);
  const safeFileName = typeof body?.fileName === "string" ? body.fileName.slice(0, 255) : "";
  const fileFingerprint = body?.fileFingerprint || null;
  if (!Number.isSafeInteger(fileSize) || fileSize < 100 || fileSize > MAX_FILE_SIZE ||
      !safeFileName.toLowerCase().endsWith(".pdf") ||
      (fileFingerprint !== null && (typeof fileFingerprint !== "string" || !/^[0-9a-f]{64}$/i.test(fileFingerprint)))) {
    return reply("Invalid upload. A PDF of up to 2 GiB is required.", 413, headers);
  }

  // Create the catalogue row first. From this point onward the upload survives
  // a browser refresh or a metadata-analysis failure.
  const documentId = crypto.randomUUID();
  const key = "library/" + crypto.randomUUID() + ".pdf";
  const document = {
    id: documentId,
    title: titleFromFilename(safeFileName),
    authors: [],
    category: "General",
    description: "",
    provider: "r2",
    r2_key: key,
    mime_type: "application/pdf",
    size_bytes: fileSize,
    is_demo: false,
    is_published: false,
    file_fingerprint: fileFingerprint,
    metadata_source: "filename",
    metadata_reviewed: false,
    metadata_status: "pending",
    metadata_error: null,
    upload_status: "uploading",
    original_filename: safeFileName,
    uploaded_by: auth.user.id
  };
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const insertResponse = await fetch(base + "/rest/v1/documents", {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: auth.authorization,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(document)
  });
  if (!insertResponse.ok) {
    console.error("Could not create upload catalogue row", insertResponse.status, await insertResponse.text());
    return reply("Could not reserve a catalogue entry for this PDF. The upload was not started.", 502, headers);
  }

  try {
    const upload = await env.BIBLIOTECA.createMultipartUpload(key, {
      httpMetadata: { contentType: "application/pdf", cacheControl: "private, no-store" },
      customMetadata: {
        documentId,
        expectedSize: String(fileSize),
        uploadedBy: auth.user.id,
        originalFilename: safeFileName,
        fileFingerprint: fileFingerprint || ""
      }
    });
    return jsonReply({ documentId, key: upload.key, uploadId: upload.uploadId, partSize: PART_SIZE }, 201, headers);
  } catch (error) {
    const deleteQuery = new URLSearchParams({ id: "eq." + documentId });
    await fetch(base + "/rest/v1/documents?" + deleteQuery, {
      method: "DELETE",
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth.authorization }
    });
    console.error("R2 multipart start failed", error);
    return reply("Could not start the upload. No PDF was stored.", 502, headers);
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
  try { body = await request.json(); } catch { return reply("Invalid completion data.", 400, headers); }
  const { key, uploadId, documentId, parts, fileSize, fileFingerprint } = body || {};
  if (!validUploadKey(key) || !UUID_RE.test(documentId || "") ||
      typeof uploadId !== "string" || !uploadId || uploadId.length > 512 ||
      !Array.isArray(parts) || parts.length < 1 || parts.length > 10000 ||
      !Number.isSafeInteger(fileSize) || fileSize < 100 || fileSize > MAX_FILE_SIZE ||
      (fileFingerprint != null && (typeof fileFingerprint !== "string" || !/^[0-9a-f]{64}$/i.test(fileFingerprint)))) {
    return reply("Invalid upload completion data.", 400, headers);
  }
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const lookup = new URLSearchParams({ select: "id,r2_key,size_bytes,upload_status", id: "eq." + documentId, provider: "eq.r2", limit: "1" });
  const lookupResponse = await fetch(base + "/rest/v1/documents?" + lookup, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth.authorization, Accept: "application/json" }
  });
  if (!lookupResponse.ok) return reply("Could not verify the reserved catalogue entry.", 502, headers);
  const existingRows = await lookupResponse.json();
  const existing = Array.isArray(existingRows) ? existingRows[0] : null;
  if (!existing || existing.r2_key !== key) return reply("The reserved catalogue entry does not match this upload.", 409, headers);

  let object;
  try {
    object = await env.BIBLIOTECA.resumeMultipartUpload(key, uploadId).complete(
      [...parts].sort((a, b) => Number(a.partNumber) - Number(b.partNumber))
    );
  } catch (error) {
    // A retry after an uncertain client response can find the object already committed.
    const alreadyStored = await env.BIBLIOTECA.head(key);
    if (!alreadyStored || alreadyStored.size !== fileSize) {
      console.error("R2 multipart completion failed", error);
      return reply("The PDF could not be assembled. The reserved entry remains available for recovery.", 400, headers);
    }
    object = alreadyStored;
  }
  const stored = await env.BIBLIOTECA.head(key);
  if (!stored || stored.size !== fileSize || object.size !== fileSize) {
    const failurePatch = await fetch(base + "/rest/v1/documents?id=eq." + encodeURIComponent(documentId), {
      method: "PATCH",
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        Authorization: auth.authorization,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ upload_status: "failed", metadata_error: "El tamaño del objeto no coincide con el archivo seleccionado." })
    });
    if (!failurePatch.ok) console.error("Could not mark size-mismatch upload as failed", await failurePatch.text());
    return reply("The stored PDF size does not match the selected file. It was retained for administrator review.", 409, headers);
  }

  const patch = {
    upload_status: "stored",
    size_bytes: stored.size,
    file_fingerprint: fileFingerprint || existing.file_fingerprint || stored.customMetadata?.fileFingerprint || null,
    metadata_status: "pending",
    metadata_error: null
  };
  const updateResponse = await fetch(base + "/rest/v1/documents?id=eq." + encodeURIComponent(documentId) + "&r2_key=eq." + encodeURIComponent(key), {
    method: "PATCH",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: auth.authorization,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(patch)
  });
  if (!updateResponse.ok) {
    // Do not delete a committed R2 object just because PostgREST is unavailable.
    console.error("PDF committed but catalogue status update failed", updateResponse.status, await updateResponse.text());
    return jsonReply({ ok: true, stored: true, catalogueSynced: false, documentId }, 202, headers);
  }
  const updatedRows = await updateResponse.json();
  if (!Array.isArray(updatedRows) || updatedRows.length !== 1) {
    return jsonReply({ ok: true, stored: true, catalogueSynced: false, documentId }, 202, headers);
  }
  return jsonReply({ ok: true, stored: true, catalogueSynced: true, documentId }, 201, headers);
}

async function uploadAbort(request, env, headers) {
  const auth = await requireAdmin(request, env, headers);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  const uploadId = url.searchParams.get("uploadId");
  const documentId = url.searchParams.get("documentId");
  if (!validUploadKey(key) || !uploadId || uploadId.length > 512 || !UUID_RE.test(documentId || "")) {
    return reply("Invalid upload abort request.", 400, headers);
  }
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const existingObject = await env.BIBLIOTECA.head(key);
  if (existingObject) {
    const lookup = new URLSearchParams({ select: "r2_key,size_bytes,file_fingerprint", id: "eq." + documentId, limit: "1" });
    const lookupResponse = await fetch(base + "/rest/v1/documents?" + lookup, {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth.authorization, Accept: "application/json" }
    });
    if (lookupResponse.ok) {
      const rows = await lookupResponse.json(), row = Array.isArray(rows) ? rows[0] : null;
      if (row && row.r2_key === key && Number(row.size_bytes) === existingObject.size) {
        const patch = await fetch(base + "/rest/v1/documents?id=eq." + encodeURIComponent(documentId), {
          method: "PATCH",
          headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth.authorization, "Content-Type": "application/json", Prefer: "return=representation" },
          body: JSON.stringify({ upload_status: "stored", size_bytes: existingObject.size, file_fingerprint: row.file_fingerprint || existingObject.customMetadata?.fileFingerprint || null, metadata_status: "pending", metadata_error: null })
        });
        return jsonReply({ stored: true, documentId, catalogueSynced: patch.ok }, 200, headers);
      }
    }
    return jsonReply({ stored: true, documentId, catalogueSynced: false }, 200, headers);
  }
  try { await env.BIBLIOTECA.resumeMultipartUpload(key, uploadId).abort(); } catch (error) {
    console.error("R2 multipart abort failed", error);
  }
  const patch = await fetch(base + "/rest/v1/documents?id=eq." + encodeURIComponent(documentId), {
    method: "PATCH",
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth.authorization, "Content-Type": "application/json" },
    body: JSON.stringify({ upload_status: "failed", metadata_error: "La carga se interrumpió antes de completar el PDF." })
  });
  return jsonReply({ stored: false, failed: true, documentId, catalogueSynced: patch.ok }, 200, headers);
}

async function reconcileStorage(request, env, headers, auth) {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const rows = [];
  let offset = 0;
  while (true) {
    const query = new URLSearchParams({ select: "id,r2_key,size_bytes,file_fingerprint,upload_status,metadata_status,created_at", provider: "eq.r2", order: "created_at.asc", limit: "1000", offset: String(offset) });
    const response = await fetch(base + "/rest/v1/documents?" + query, {
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth.authorization, Accept: "application/json" }
    });
    if (!response.ok) return reply("Could not read the catalogue for reconciliation.", 502, headers);
    const page = await response.json();
    rows.push(...(Array.isArray(page) ? page : []));
    if (!Array.isArray(page) || page.length < 1000) break;
    offset += 1000;
  }
  const byKey = new Map(rows.filter(row => row.r2_key).map(row => [row.r2_key, row]));
  const objects = [];
  let cursor;
  do {
    const result = await env.BIBLIOTECA.list({
      prefix: "library/",
      limit: 1000,
      ...(cursor ? { cursor } : {}),
      include: ["customMetadata"]
    });
    objects.push(...(result.objects || []));
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);

  const candidates = objects.filter(object => validUploadKey(object.key));
  const stats = { scanned: candidates.length, recovered: 0, completed: 0, failed: 0, errors: [] };
  let cursorIndex = 0;
  const worker = async () => {
    while (true) {
      const index = cursorIndex++;
      if (index >= candidates.length) return;
      const object = candidates[index];
      const custom = object.customMetadata || {};
      const existing = byKey.get(object.key);
      try {
        if (existing) {
          if (existing.upload_status !== "stored" && Number(existing.size_bytes) === object.size) {
            const patch = await fetch(base + "/rest/v1/documents?id=eq." + encodeURIComponent(existing.id), {
              method: "PATCH",
              headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth.authorization, "Content-Type": "application/json", Prefer: "return=representation" },
              body: JSON.stringify({
                upload_status: "stored",
                file_fingerprint: existing.file_fingerprint || custom.fileFingerprint || null,
                metadata_status: "pending",
                metadata_error: null
              })
            });
            if (patch.ok) stats.completed++;
            else { stats.failed++; stats.errors.push(object.key + ": catalogue status update failed"); }
          }
          continue;
        }
        const title = titleFromFilename(custom.originalFilename || object.key.split("/").pop());
        const recoveredId = UUID_RE.test(custom.documentId || "") ? custom.documentId : crypto.randomUUID();
        const restored = {
          id: recoveredId,
          title,
          authors: [],
          category: "General",
          description: "",
          provider: "r2",
          r2_key: object.key,
          mime_type: "application/pdf",
          size_bytes: object.size,
          is_demo: false,
          is_published: false,
          file_fingerprint: /^[0-9a-f]{64}$/i.test(custom.fileFingerprint || "") ? custom.fileFingerprint : null,
          metadata_source: "filename",
          metadata_reviewed: false,
          metadata_status: "pending",
          metadata_error: null,
          upload_status: "stored",
          original_filename: custom.originalFilename || object.key.split("/").pop(),
          uploaded_by: UUID_RE.test(auth.user.id) ? auth.user.id : null
        };
        const insert = await fetch(base + "/rest/v1/documents", {
          method: "POST",
          headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth.authorization, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify(restored)
        });
        if (insert.ok) {
          byKey.set(object.key, restored);
          stats.recovered++;
        } else {
          const error = await insert.text();
          stats.failed++;
          if (stats.errors.length < 10) stats.errors.push(object.key + ": " + error.slice(0, 200));
        }
      } catch (error) {
        stats.failed++;
        if (stats.errors.length < 10) stats.errors.push(object.key + ": " + String(error).slice(0, 200));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, candidates.length) }, worker));

  const staleBefore = Date.now() - 30 * 60 * 1000;
  const stale = rows.filter(row => row.upload_status === "uploading" && Date.parse(row.created_at || "") < staleBefore && !candidates.some(object => object.key === row.r2_key));
  for (const row of stale) {
    const patch = await fetch(base + "/rest/v1/documents?id=eq." + encodeURIComponent(row.id), {
      method: "PATCH",
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth.authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ upload_status: "failed", metadata_error: "La carga multipart quedó interrumpida; no se encontró un PDF completo en R2." })
    });
    if (patch.ok) stats.failed++;
  }
  return jsonReply(stats, 200, headers);
}


async function deleteLibraryDocument(request, env, headers, documentId) {
  const auth = await requireAdmin(request, env, headers);
  if (auth.response) return auth.response;
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const selectQuery = new URLSearchParams({ select: "id,provider,r2_key", id: "eq." + documentId, limit: "1" });
  const metadataResponse = await fetch(base + "/rest/v1/documents?" + selectQuery, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: auth.authorization,
      Accept: "application/json"
    }
  });
  if (!metadataResponse.ok) return reply("Could not retrieve document metadata", 502, headers);
  const rows = await metadataResponse.json();
  const document = Array.isArray(rows) ? rows[0] : null;
  if (!document) return reply("Document not found", 404, headers);

  const deleteQuery = new URLSearchParams({ id: "eq." + documentId });
  const deleteResponse = await fetch(base + "/rest/v1/documents?" + deleteQuery, {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: auth.authorization,
      Prefer: "return=representation"
    }
  });
  if (!deleteResponse.ok) {
    console.error("Document database deletion failed", deleteResponse.status, await deleteResponse.text());
    return reply("Could not remove the document from the catalogue", 502, headers);
  }
  const deletedRows = await deleteResponse.json();
  if (!Array.isArray(deletedRows) || deletedRows.length !== 1) {
    return reply("Document deletion was not confirmed", 409, headers);
  }

  let storageCleanupPending = false;
  if (document.provider === "r2" && typeof document.r2_key === "string" && document.r2_key) {
    try {
      await env.BIBLIOTECA.delete(document.r2_key);
    } catch (error) {
      storageCleanupPending = true;
      console.error("Orphaned private R2 object requires cleanup", { key: document.r2_key, error: String(error) });
    }
  }
  return jsonReply({ ok: true, storageCleanupPending }, 200, headers);
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
    if (pathname === "/admin/reconcile-storage" && request.method === "POST") {
      const auth = await requireAdmin(request, env, headers);
      if (auth.response) return auth.response;
      return reconcileStorage(request, env, headers, auth);
    }
    const deleteMatch = pathname.match(/^\/document\/([^/]+)$/);
    if (deleteMatch && request.method === "DELETE") {
      const documentId = deleteMatch[1];
      if (!UUID_RE.test(documentId)) return reply("Not found", 404, headers);
      try {
        return await deleteLibraryDocument(request, env, headers, documentId);
      } catch (error) {
        console.error("Document deletion failed", error);
        return reply("Unable to delete document", 502, headers);
      }
    }

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
