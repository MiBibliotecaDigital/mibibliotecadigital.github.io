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

function pdfContentDisposition(title, disposition = "inline") {
  const cleanTitle = String(title || "document")
    .replace(/\s*\|\s*(?:BA|MEL)\s*[-.]?\s*\d{3,8}\s*$/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150) || "document";
  const filename = cleanTitle + ".pdf";
  const fallback = filename.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\;]/g, "_");
  const encoded = encodeURIComponent(filename)
    .replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16).toUpperCase());
  return disposition + '; filename="' + fallback + '"; filename*=UTF-8\'\'' + encoded;
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
  const normalizedParts = [...parts].sort((a, b) => Number(a?.partNumber) - Number(b?.partNumber));
  for (let i = 0; i < normalizedParts.length; i++) {
    const part = normalizedParts[i];
    if (Number(part?.partNumber) !== i + 1 || typeof part?.etag !== "string" ||
        !part.etag || part.etag.length > 256) {
      return reply("The uploaded parts are incomplete or invalid.", 400, headers);
    }
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
    object = await env.BIBLIOTECA.resumeMultipartUpload(key, uploadId).complete(normalizedParts);
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
    const failurePatch = await fetch(base + "/rest/v1/documents?id=eq." + encodeURIComponent(documentId), {
      method: "PATCH",
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth.authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ upload_status: "failed", metadata_error: "Se encontró un objeto R2, pero no coincide con la ficha de carga o su tamaño esperado." })
    });
    if (!failurePatch.ok) console.error("Could not mark invalid completed object as failed", await failurePatch.text());
    return jsonReply({ stored: false, failed: true, documentId, catalogueSynced: false }, 409, headers);
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
    const query = new URLSearchParams({ select: "id,r2_key,size_bytes,file_fingerprint,upload_status,metadata_status,metadata_reviewed,original_filename,created_at", provider: "eq.r2", order: "created_at.asc", limit: "1000", offset: String(offset) });
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
  const stats = { filenameRecoveryVersion: 1, scanned: candidates.length, recovered: 0, completed: 0, filenamesRecovered: 0, filenamesUnavailable: 0, failed: 0, errors: [] };
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
          const patchData = {};
          if (!existing.original_filename && typeof custom.originalFilename === "string" &&
              custom.originalFilename.trim() && custom.originalFilename.length <= 255) {
            patchData.original_filename = custom.originalFilename.trim();
          }
          if (existing.upload_status !== "stored" && Number(existing.size_bytes) === object.size) {
            patchData.upload_status = "stored";
            patchData.file_fingerprint = existing.file_fingerprint || custom.fileFingerprint || null;
            patchData.metadata_status = "pending";
            patchData.metadata_error = null;
          }
          if (Object.keys(patchData).length) {
            const patch = await fetch(base + "/rest/v1/documents?id=eq." + encodeURIComponent(existing.id), {
              method: "PATCH",
              headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth.authorization, "Content-Type": "application/json", Prefer: "return=representation" },
              body: JSON.stringify(patchData)
            });
            if (!patch.ok) {
              stats.failed++;
              if (stats.errors.length < 10) stats.errors.push(object.key + ": catalogue metadata update failed");
            } else {
              if (patchData.upload_status === "stored") stats.completed++;
              if (patchData.original_filename) stats.filenamesRecovered++;
            }
          } else if (!existing.original_filename) {
            stats.filenamesUnavailable++;
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
          original_filename: custom.originalFilename || null,
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
          if (restored.original_filename) stats.filenamesRecovered++;
          else stats.filenamesUnavailable++;
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
      await env.BIBLIOTECA.delete("covers/" + documentId + ".jpg");
    } catch (error) {
      storageCleanupPending = true;
      console.error("Orphaned private R2 object requires cleanup", { key: document.r2_key, error: String(error) });
    }
  }
  return jsonReply({ ok: true, storageCleanupPending }, 200, headers);
}



async function getLibraryThumbnail(request, env, headers, documentId) {
  const authorization = request.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply("Authentication required", 401, headers);
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.BIBLIOTECA) return reply("Gateway is not configured", 503, headers);
  const query = new URLSearchParams({ select: "id,provider,r2_key", id: "eq." + documentId, provider: "eq.r2", limit: "1" });
  const response = await fetch(env.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/documents?" + query, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: authorization, Accept: "application/json" }
  });
  if (response.status === 401 || response.status === 403) return reply("Authentication or permission check failed", response.status, headers);
  if (!response.ok) return reply("Authorization service unavailable", 502, headers);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0]) return reply("Thumbnail not found", 404, headers);
  const object = await env.BIBLIOTECA.get("covers/" + documentId + ".jpg");
  if (!object) return reply("Thumbnail not generated", 404, headers);
  headers.set("Content-Type", "image/jpeg");
  headers.set("Content-Length", String(object.size));
  headers.set("Cache-Control", "private, max-age=86400");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(object.body, { status: 200, headers });
}

async function putLibraryThumbnail(request, env, headers, documentId) {
  const auth = await requireAdmin(request, env, headers);
  if (auth.response) return auth.response;
  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "image/jpeg") return reply("Only JPEG thumbnails are accepted", 415, headers);
  const declaredSize = Number(request.headers.get("Content-Length") || 0);
  if (declaredSize > 512 * 1024) return reply("Thumbnail exceeds the 512 KiB limit", 413, headers);
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const query = new URLSearchParams({ select: "id,provider,r2_key,upload_status", id: "eq." + documentId, provider: "eq.r2", upload_status: "eq.stored", limit: "1" });
  const response = await fetch(base + "/rest/v1/documents?" + query, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: auth.authorization, Accept: "application/json" }
  });
  if (!response.ok) return reply("Could not verify document ownership", 502, headers);
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0]) return reply("Stored document not found", 404, headers);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > 512 * 1024) return reply("Thumbnail size is invalid", 413, headers);
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return reply("Thumbnail is not a valid JPEG image", 415, headers);
  await env.BIBLIOTECA.put("covers/" + documentId + ".jpg", bytes, {
    httpMetadata: { contentType: "image/jpeg", cacheControl: "private, max-age=31536000, immutable" },
    customMetadata: { documentId, generatedBy: auth.user.id }
  });
  return jsonReply({ ok: true, documentId, size: bytes.length }, 201, headers);
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
    if (pathname === "/catalog/google-books" && request.method === "GET") return lookupGoogleBooks(request, env, headers);
    if (pathname === "/catalog/isbnlab" && request.method === "GET") return lookupIsbnLabBook(request, env, headers);
    if (pathname === "/catalog/melos" && request.method === "GET") return lookupMelosProduct(request, env, headers);
    if (pathname === "/upload/start" && request.method === "POST") return uploadStart(request, env, headers);
    if (pathname === "/upload/part" && request.method === "PUT") return uploadPart(request, env, headers);
    if (pathname === "/upload/complete" && request.method === "POST") return uploadComplete(request, env, headers);
    if (pathname === "/upload/abort" && request.method === "DELETE") return uploadAbort(request, env, headers);

function normalizeMelosCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function decodeMelosHtml(value) {
  const named = {
    nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">",
    ndash: "–", mdash: "—", hellip: "…", times: "×", deg: "°",
    acute: "´", eacute: "é", Eacute: "É", aacute: "á", Aacute: "Á",
    iacute: "í", Iacute: "Í", oacute: "ó", Oacute: "Ó", uacute: "ú",
    Uacute: "Ú", ntilde: "ñ", Ntilde: "Ñ",uuml: "ü", Uuml: "Ü"
  };
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      try { return Number.isFinite(code) ? String.fromCodePoint(code) : match; } catch { return match; }
    }
    return named[entity] ?? match;
  });
}

function melosHtmlText(value) {
  return decodeMelosHtml(String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6]|div|tr|td|th|section|article|ul|ol|header|footer|main|aside)>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function melosNormLabel(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function melosReadRows(html) {
  const rows = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowPattern.exec(html))) {
    const cells = [];
    const cellPattern = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cell;
    while ((cell = cellPattern.exec(row[1]))) cells.push(melosHtmlText(cell[1]));
    if (cells.length >= 2 && cells[0] && cells[1]) rows.push({ label: cells[0], value: cells.slice(1).join(" · ") });
  }
  return rows;
}

function melosReadField(lines, labels) {
  const wanted = new Set(labels.map(melosNormLabel));
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || "").trim();
    const colon = line.indexOf(":");
    if (colon >= 0 && wanted.has(melosNormLabel(line.slice(0, colon)))) return line.slice(colon + 1).trim();
    if (wanted.has(melosNormLabel(line))) {
      for (let next = i + 1; next < lines.length; next++) {
        if (String(lines[next] || "").trim()) return String(lines[next]).trim();
      }
    }
  }
  return "";
}

function melosTagLinks(html) {
  const tags = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const href = (match[1].match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    if (/\/(?:etiqueta-producto|product-tag)\//i.test(href)) {
      const value = melosHtmlText(match[2]);
      if (value && !tags.includes(value)) tags.push(value);
    }
  }
  return tags.slice(0, 40);
}

function melosProductLinks(html) {
  const links = [];
  const seen = new Set();
  const pattern = /\b(?:href|data-product_permalink)\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const raw = decodeMelosHtml(match[1]);
    let url;
    try { url = new URL(raw, "https://melos.com.ar"); } catch { continue; }
    if (url.origin !== "https://melos.com.ar" || !/^\/producto\/[^/]+\/?$/i.test(url.pathname)) continue;
    url.search = "";
    url.hash = "";
    const canonical = url.href.replace(/\/?$/, "/");
    if (!seen.has(canonical)) { seen.add(canonical); links.push(canonical); }
    if (links.length >= 12) break;
  }
  return links;
}

function melosExtractProduct(html, productUrl, expectedCode) {
  const text = melosHtmlText(html);
  const lines = text.split("\n").map(x => x.trim()).filter(Boolean);
  const rows = melosReadRows(html);
  const rowValues = labels => {
    const wanted = new Set(labels.map(melosNormLabel));
    return rows.filter(row => wanted.has(melosNormLabel(row.label))).map(row => row.value).filter(Boolean);
  };
  const value = (labels, lineLabels = labels) =>
    rowValues(labels)[0] || melosReadField(lines, lineLabels);
  const heading = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "";
  const title = melosHtmlText(heading) || melosHtmlText((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
  const author = value(["Autor/Marca", "Autor", "Marca"]);
  const instrument = value(["Instrumento"]);
  const productCode = value(["Cod", "Código"]);
  if (normalizeMelosCode(productCode) !== expectedCode) return null;

  const tagsText = melosReadField(lines, ["Tags", "Etiquetas"]);
  const tags = melosTagLinks(html);
  if (!tags.length && tagsText) tags.push(tagsText);
  const barcode = value(["Cod de Barras", "Código de Barras", "Barcode", "EAN"]);
  const collaborators = rowValues(["Colaboradores"])
    .flatMap(x => x.split(/\s*(?:\n|;|\|)\s*/)).map(x => x.trim()).filter(Boolean);
  const pageCount = value(["Cantidad de paginas", "Cantidad de páginas", "Páginas"]);
  const descriptionStart=lines.findIndex(line=>/^descripci[oó]n\s*:?$/i.test(line));
  const descriptionEnd=lines.findIndex((line,index)=>index>descriptionStart&&/^informaci[oó]n adicional$/i.test(line));
  const description=(
    melosReadField(lines,["Descripción"])||
    (descriptionStart>=0?lines.slice(descriptionStart+1,descriptionEnd>descriptionStart?descriptionEnd:descriptionStart+12).join(" ").trim():"")
  ).slice(0,3000);
  const issuuRaw=(html.match(/\bhref\s*=\s*["']([^"']*issuu\.com[^"']*)["']/i)||[])[1]||
    (text.match(/https?:\/\/(?:www\.)?issuu\.com\/[^\s<>"']+/i)||[])[0]||"";
  let issuuUrl="";
  try{const parsed=new URL(decodeMelosHtml(issuuRaw),"https://melos.com.ar");if(parsed.hostname==="issuu.com"||parsed.hostname.endsWith(".issuu.com"))issuuUrl=parsed.href;}catch{}
  const documentKind=/^armon[ií]a$/i.test(instrument)&&/\b(?:libro|tratado|manual)\b/i.test(description)?"book":"music_score";
  const attributes = rows.map(row => ({ label: row.label, value: row.value }));
  const shippingWeight = (text.match(/\bPeso\s+(\d+(?:[.,]\d+)?\s*kg)\b/i) || [])[1] || "";
  const dimensions = (text.match(/\bDimensiones\s+([0-9.,\s×x]+(?:cm|mm)?)\b/i) || [])[1]?.trim() || "";
  const price = (html.match(/<p\b[^>]*class=["'][^"']*price[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) || [])[1] ||
    (html.match(/<span\b[^>]*class=["'][^"']*woocommerce-Price-amount[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1] || "";
  const stock = (text.match(/\b(\d+)\s+disponibles?\b/i) || [])[0] || "";

  return {
    title: title.slice(0, 300),
    author: author.slice(0, 300),
    instrument: instrument.slice(0, 120),
    code: productCode,
    tagsText: tagsText.slice(0, 500),
    tags,
    publisher: "Ediciones Melos",
    barcode: barcode.slice(0, 80),
    shippingWeight: shippingWeight.slice(0, 40),
    dimensions: dimensions.slice(0, 80),
    collaborators: [...new Set(collaborators)].slice(0, 30),
    editionWeight: value(["Peso"]).slice(0, 80),
    height: value(["Alto"]).slice(0, 40),
    width: value(["Ancho"]).slice(0, 40),
    countryOfOrigin: value(["Pais de origen", "País de origen"]).slice(0, 100),
    priceLetter: value(["Letra-Precio", "Letra Precio"]).slice(0, 40),
    accessories: value(["Accesorios"]).slice(0, 200),
    editionPageCount: pageCount.slice(0, 80),
    price: melosHtmlText(price).slice(0, 80),
    stock: stock.slice(0, 80),
    description,
    issuuUrl,
    documentKind,
    attributes,
    url: productUrl
  };
}

function googleTagAttribute(tag, name) {
  const match = tag.match(new RegExp("\\b" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", "i"));
  return match ? decodeMelosHtml(match[2]) : "";
}

function googleMetaValue(html, keys) {
  const wanted = new Set(keys.map(x => x.toLowerCase()));
  const pattern = /<(?:meta|link)\b[^>]*>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const tag = match[0];
    const key = googleTagAttribute(tag, "itemprop") || googleTagAttribute(tag, "property") ||
      googleTagAttribute(tag, "name") || googleTagAttribute(tag, "rel");
    if (wanted.has(key.toLowerCase())) {
      const value = googleTagAttribute(tag, "content") || googleTagAttribute(tag, "href");
      if (value) return value.trim();
    }
  }
  return "";
}

function googleItempropValues(html, prop) {
  const values = [];
  const metaPattern = /<meta\b[^>]*>/gi;
  let meta;
  while ((meta = metaPattern.exec(html))) {
    const tag = meta[0];
    if (googleTagAttribute(tag, "itemprop").toLowerCase() === prop.toLowerCase()) {
      const value = googleTagAttribute(tag, "content");
      if (value && !values.includes(value)) values.push(value);
    }
  }
  const pattern = /<([a-z][a-z0-9]*)\b([^>]*\bitemprop\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    if (match[3].toLowerCase() !== prop.toLowerCase()) continue;
    const value = googleTagAttribute("<" + match[1] + match[2] + ">", "content") || melosHtmlText(match[4]);
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}
function googleJsonBooks(html) {
  const found = [];
  const scripts = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let script;
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const child of value) visit(child); return; }
    const type = Array.isArray(value["@type"]) ? value["@type"].join(" ") : String(value["@type"] || "");
    const title = value.name || value.headline || value.title || "";
    if (title && (/book/i.test(type) || value.isbn || value.numberOfPages || value.bookFormat)) {
      const personName = x => typeof x === "string" ? x : x?.name || "";
      const names = value.author || value.creator || [];
      const authors = (Array.isArray(names) ? names : [names]).map(personName).filter(Boolean);
      const publisher = typeof value.publisher === "string" ? value.publisher : value.publisher?.name || "";
      const isbnValues = String(value.isbn || "").split(/[,;\s]+/).filter(Boolean);
      found.push({
        title: String(title),
        authors,
        publisher,
        publishedDate: String(value.datePublished || ""),
        pageCount: Number(value.numberOfPages) || null,
        description: String(value.description || ""),
        categories: (Array.isArray(value.genre) ? value.genre : value.genre ? [value.genre] : []).map(String),
        industryIdentifiers: isbnValues.map(identifier => ({ type: identifier.replace(/\D/g, "").length === 10 ? "ISBN_10" : "ISBN_13", identifier })),
        printType: "BOOK",
        sourceUrl: String(value.url || value["@id"] || "")
      });
    }
    for (const child of Object.values(value)) if (child && typeof child === "object") visit(child);
  };
  while ((script = scripts.exec(html))) {
    try { visit(JSON.parse(decodeMelosHtml(script[1]))); } catch {}
  }
  return found;
}

function googleBookFromHtml(html, bookUrl, queriedIsbn, fallbackTitle = "") {
  const structured = googleJsonBooks(html)[0] || {};
  const rows = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowPattern.exec(html))) {
    const cells = [];
    const cellPattern = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
    let cell;
    while ((cell = cellPattern.exec(row[1]))) cells.push(melosHtmlText(cell[1]));
    if (cells.length >= 2) rows.push([cells[0].replace(/:$/, "").trim().toLowerCase(), cells.slice(1).join(" ").trim()]);
  }
  const rowValue = (...labels) => {
    const keyset = new Set(labels.map(x => x.toLowerCase()));
    return rows.find(([label, value]) => keyset.has(label) && value)?.[1] || "";
  };
  const heading = (html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "";
  const title = structured.title ||
    googleMetaValue(html, ["og:title", "twitter:title", "name"]) ||
    melosHtmlText(heading) || rowValue("title") || fallbackTitle;
  if (!title || title.length < 4) return null;

  const authors = structured.authors?.length ? structured.authors :
    googleItempropValues(html, "author").concat(
      rowValue("author", "authors").split(/\s*[,;]\s*/).filter(Boolean)
    );
  const publisher = structured.publisher || rowValue("publisher");
  const publishedDate = structured.publishedDate || rowValue("published", "publication date", "date");
  const description = structured.description || googleMetaValue(html, ["og:description", "description"]) ||
    rowValue("description");
  const pageText = structured.pageCount || rowValue("length", "pages");
  const pageCount = Number(String(pageText || "").match(/\d+/)?.[0]) || null;
  const subjectText = rowValue("subjects", "subject");
  const categories = structured.categories?.length ? structured.categories :
    subjectText.split(/\s*[›;|]\s*/).filter(Boolean);
  const rawIsbns = [
    ...(structured.industryIdentifiers || []).map(x => x.identifier),
    ...googleItempropValues(html, "isbn"),
    ...(html.match(/(?:97[89]\d{10}|\b\d{9}[\dXx]\b)/g) || [])
  ];
  const identifierMap = new Map();
  for (const raw of rawIsbns) {
    const id = String(raw || "").replace(/[^0-9Xx]/g, "").toUpperCase();
    if ((id.length === 10 || id.length === 13) && !identifierMap.has(id)) {
      identifierMap.set(id, { type: id.length === 10 ? "ISBN_10" : "ISBN_13", identifier: id });
    }
  }
  // Search results are returned for this exact ISBN query. Attach the query ISBN
  // so the client can independently compare it with title and author before accepting.
  if (queriedIsbn && !identifierMap.has(queriedIsbn)) {
    identifierMap.set(queriedIsbn, { type: queriedIsbn.length === 10 ? "ISBN_10" : "ISBN_13", identifier: queriedIsbn });
  }
  const id = (() => { try { return new URL(bookUrl).searchParams.get("id") || bookUrl; } catch { return bookUrl; } })();
  return {
    id,
    volumeInfo: {
      title: String(title).replace(/\s*-\s*Google Books\s*$/i, "").trim(),
      authors: [...new Set(authors.map(x => String(x).trim()).filter(Boolean))],
      publisher,
      publishedDate,
      description,
      pageCount,
      categories,
      industryIdentifiers: [...identifierMap.values()],
      printType: "BOOK",
      infoLink: bookUrl
    }
  };
}

function googleBookResultLinks(html) {
  const links = [];
  const seen = new Set();
  const anchors = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let anchor;
  while ((anchor = anchors.exec(html))) {
    const hrefMatch = anchor[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    let href = hrefMatch ? decodeMelosHtml(hrefMatch[2]) : "";
    if (!href) continue;
    try {
      let url = new URL(href, "https://www.google.es");
      if (/^(?:www\.)?google\.(?:com|es)$/.test(url.hostname) && /\/url$/.test(url.pathname)) {
        const wrapped = url.searchParams.get("q") || url.searchParams.get("url");
        if (!wrapped) continue;
        url = new URL(wrapped);
      }
      if (!/^books\.google\.(?:com|es)$/i.test(url.hostname) || !/^\/books(?:\/|$)/i.test(url.pathname)) continue;
      url.hash = "";
      const canonical = url.href;
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      links.push({ url: canonical, title: melosHtmlText(anchor[2]) });
      if (links.length >= 5) break;
    } catch {}
  }
  return links;
}

async function lookupGoogleBooks(request, env, headers) {
  const auth = await requireAdmin(request, env, headers);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const isbn = String(url.searchParams.get("isbn") || "").replace(/[\s-]/g, "").toUpperCase();
  const title = String(url.searchParams.get("title") || "").trim().slice(0, 180);
  const author = String(url.searchParams.get("author") || "").trim().slice(0, 120);
  let query = "";
  if (isbn) {
    if (!/^(?:\d{9}[\dX]|\d{13})$/.test(isbn)) {
      return jsonReply({ error: "A valid ISBN-10 or ISBN-13 is required.", code: "invalid_isbn" }, 400, headers);
    }
    query = "isbn:" + isbn;
  } else if (title) {
    query = '"' + title.replace(/["<>]/g, " ") + '"';
    if (author) query += ' "' + author.replace(/["<>]/g, " ") + '"';
  } else {
    return jsonReply({ error: "An ISBN or title is required.", code: "missing_query" }, 400, headers);
  }

  const searchUrl = new URL("https://www.google.es/search");
  searchUrl.searchParams.set("hl", "es");
  searchUrl.searchParams.set("tbo", "p");
  searchUrl.searchParams.set("tbm", "bks");
  searchUrl.searchParams.set("q", query);

  let searchResponse;
  try {
    searchResponse = await fetch(searchUrl.toString(), {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "es-AR,es;q=0.9,en;q=0.7",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36"
      },
      signal: AbortSignal.timeout(12000)
    });
  } catch (error) {
    console.error("Google Books web search failed", error);
    return jsonReply({
      error: "Google Books web search request failed.",
      code: "google_books_unavailable",
      detail: String(error?.message || error).slice(0, 240),
      queryUrl: searchUrl.toString()
    }, 502, headers);
  }

  if (searchResponse.status === 429 || searchResponse.status === 503) {
    return jsonReply({
      error: "Google Books web search is temporarily rate-limited or unavailable.",
      code: "google_books_rate_limited",
      retryAfterSeconds: Number(searchResponse.headers.get("Retry-After")) || 300,
      upstreamStatus: searchResponse.status,
      queryUrl: searchUrl.toString()
    }, 429, headers);
  }
  if (!searchResponse.ok) {
    return jsonReply({
      error: "Google Books web search returned HTTP " + searchResponse.status,
      code: "google_books_upstream_error",
      upstreamStatus: searchResponse.status,
      queryUrl: searchUrl.toString()
    }, 502, headers);
  }

  const searchHtml = await searchResponse.text();
  if (/unusual traffic|our systems have detected|recaptcha|\/sorry\/index/i.test(searchHtml)) {
    return jsonReply({
      error: "Google Books is presenting an anti-automation challenge; this is not a no-results response.",
      code: "google_books_challenge",
      retryAfterSeconds: 300,
      queryUrl: searchUrl.toString()
    }, 429, headers);
  }

  const links = googleBookResultLinks(searchHtml);
  const detailResults = await Promise.all(links.slice(0, 4).map(async item => {
    try {
      const response = await fetch(item.url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "es-AR,es;q=0.9,en;q=0.7",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36"
        },
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) return null;
      const html = await response.text();
      return googleBookFromHtml(html, item.url, isbn, item.title);
    } catch { return null; }
  }));

  const candidates = detailResults.filter(Boolean);
  if (!candidates.length) {
    const searchText = melosHtmlText(searchHtml).slice(0, 6000);
    const noResults = /no se han encontrado resultados|no results found|did not match any books/i.test(searchText);
    if (noResults) return jsonReply({ items: [], totalItems: 0, queryUrl: searchUrl.toString() }, 200, headers);
    return jsonReply({
      error: "Google Books responded, but the book result pages could not be extracted. It is not being treated as ISBN not found.",
      code: "google_books_unparsed",
      queryUrl: searchUrl.toString()
    }, 502, headers);
  }

  return jsonReply({
    items: candidates,
    totalItems: candidates.length,
    queryUrl: searchUrl.toString()
  }, 200, headers);
}


async function lookupIsbnLabBook(request, env, headers) {
  const auth = await requireAdmin(request, env, headers);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const isbn = String(url.searchParams.get("isbn") || "").replace(/[\s-]/g, "").toUpperCase();
  if (!/^(?:\d{9}[\dX]|\d{13})$/.test(isbn)) {
    return jsonReply({ error: "A valid ISBN-10 or ISBN-13 is required.", code: "invalid_isbn" }, 400, headers);
  }
  if (!env.ISBNLAB_API_TOKEN) {
    return jsonReply({
      error: "ISBNLab is not configured. Add the ISBNLAB_API_TOKEN Worker secret.",
      code: "isbnlab_not_configured"
    }, 503, headers);
  }

  let upstream;
  try {
    upstream = await fetch("https://www.isbnlab.com/api/book/isbn/" + encodeURIComponent(isbn), {
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + env.ISBNLAB_API_TOKEN,
        "User-Agent": "MiBibliotecaDigital/1.0 (+https://mibibliotecadigital.github.io/)"
      },
      signal: AbortSignal.timeout(12000)
    });
  } catch (error) {
    console.error("ISBNLab request failed", error);
    return jsonReply({
      error: "ISBNLab request failed.",
      code: "isbnlab_unavailable",
      detail: String(error?.message || error).slice(0, 240)
    }, 502, headers);
  }

  const retryHeader = upstream.headers.get("Retry-After") || upstream.headers.get("X-RateLimit-Retry-After");
  const retryAfterSeconds = retryHeader === null ? null : Math.max(0, Number(retryHeader) || 0);
  const rateLimit = {
    limit: upstream.headers.get("X-RateLimit-Limit"),
    remaining: upstream.headers.get("X-RateLimit-Remaining"),
    retryAfterSeconds,
    plan: upstream.headers.get("X-RateLimit-Type")
  };

  if (upstream.status === 404) {
    return jsonReply({ match: false, notFound: true, isbn, rateLimit }, 200, headers);
  }

  let payload = {};
  try { payload = await upstream.json(); } catch {
    return jsonReply({ error: "ISBNLab returned an invalid JSON response.", code: "invalid_upstream_response" }, 502, headers);
  }

  if (upstream.status === 429) {
    return jsonReply({
      error: payload.detail || "ISBNLab request limit reached.",
      code: "isbnlab_rate_limited",
      retryAfterSeconds: retryAfterSeconds === null ? 1 : Math.max(1, retryAfterSeconds),
      rateLimit
    }, 429, headers);
  }
  if (!upstream.ok) {
    return jsonReply({
      error: payload.detail || ("ISBNLab HTTP " + upstream.status),
      code: upstream.status === 401 || upstream.status === 403 ? "isbnlab_auth_error" : "isbnlab_upstream_error",
      upstreamStatus: upstream.status,
      rateLimit
    }, upstream.status === 400 ? 400 : upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status >= 500 ? 503 : 502, headers);
  }
  if (!payload || typeof payload.title !== "string" || !payload.title.trim()) {
    return jsonReply({ error: "ISBNLab returned a book record without a usable title.", code: "invalid_book_record" }, 502, headers);
  }
  return jsonReply({ match: true, isbn, book: payload, rateLimit }, 200, headers);
}

async function lookupMelosProduct(request, env, headers) {
  const auth = await requireAdmin(request, env, headers);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const suppliedCode = String(url.searchParams.get("code") || "").trim().toUpperCase();
  const normalized = normalizeMelosCode(suppliedCode);
  if (!/^(?:BA|MEL)\d{3,8}$/.test(normalized)) {
    return jsonReply({ error: "Invalid Melos product code. BA and MEL codes are required." }, 400, headers);
  }
  const searchUrl = new URL("https://melos.com.ar/");
  searchUrl.searchParams.set("s", normalized.toLowerCase());
  let searchResponse;
  try {
    searchResponse = await fetch(searchUrl.toString(), {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "es-AR,es;q=0.9,en;q=0.6",
        "User-Agent": "Mozilla/5.0 (compatible; MiBibliotecaDigital/1.0; +https://mibibliotecadigital.github.io/)"
      },
      signal: AbortSignal.timeout(12000)
    });
  } catch (error) {
    console.error("Melos search request failed", error);
    return jsonReply({ error: "Melos search request failed.", detail: String(error?.message || error).slice(0, 240) }, 502, headers);
  }
  if (!searchResponse.ok) {
    return jsonReply({ error: "Melos search returned HTTP " + searchResponse.status, upstreamStatus: searchResponse.status }, 502, headers);
  }
  const searchHtml = await searchResponse.text();
  if (searchHtml.length > 5 * 1024 * 1024) return jsonReply({ error: "Melos search response is too large." }, 502, headers);
  const productUrls = melosProductLinks(searchHtml);
  const checked = [];
  for (const productUrl of productUrls.slice(0, 8)) {
    try {
      const productResponse = await fetch(productUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "es-AR,es;q=0.9,en;q=0.6",
          "User-Agent": "Mozilla/5.0 (compatible; MiBibliotecaDigital/1.0; +https://mibibliotecadigital.github.io/)",
          Referer: searchUrl.toString()
        },
        signal: AbortSignal.timeout(10000)
      });
      if (!productResponse.ok) {
        checked.push({ url: productUrl, status: productResponse.status });
        continue;
      }
      const html = await productResponse.text();
      if (html.length > 5 * 1024 * 1024) continue;
      const product = melosExtractProduct(html, productUrl, normalized);
      if (product) {
        return jsonReply({ match: true, query: searchUrl.toString(), checked: checked.length + 1, product }, 200, headers);
      }
      checked.push({ url: productUrl, status: "code-mismatch" });
    } catch (error) {
      checked.push({ url: productUrl, status: String(error?.message || error).slice(0, 160) });
    }
  }
  return jsonReply({
    match: false,
    code: suppliedCode,
    query: searchUrl.toString(),
    productCandidates: productUrls.length,
    checked: checked.slice(0, 8)
  }, 200, headers);
}


    const thumbnailMatch = pathname.match(/^\/thumbnail\/([^/]+)$/);
    if (thumbnailMatch) {
      const documentId = thumbnailMatch[1];
      if (!UUID_RE.test(documentId)) return reply("Not found", 404, headers);
      try {
        if (request.method === "GET" || request.method === "HEAD") return await getLibraryThumbnail(request, env, headers, documentId);
        if (request.method === "PUT") return await putLibraryThumbnail(request, env, headers, documentId);
        headers.set("Allow", "GET, HEAD, PUT, OPTIONS");
        return reply("Method not allowed", 405, headers);
      } catch (error) {
        console.error("Thumbnail gateway failure", error);
        return reply("Unable to retrieve or store thumbnail", 502, headers);
      }
    }

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
        select: "r2_key,mime_type,title",
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
      const downloadMode = new URL(request.url).searchParams.get("download") === "1";
      headers.set("Content-Disposition", pdfContentDisposition(document.title, downloadMode ? "attachment" : "inline"));
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
