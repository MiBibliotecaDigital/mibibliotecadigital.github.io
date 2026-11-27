import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const origin = Deno.env.get("APP_ORIGIN") ?? "https://mibibliotecadigital.github.io";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Vary": "Origin"
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
function readPublishableKey(): string {
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.default === "string") return parsed.default;
      const first = Object.values(parsed ?? {}).find((value) => typeof value === "string");
      if (typeof first === "string") return first;
    } catch { return raw; }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const body = await request.json();
    const username = String(body?.username ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    if (!/^[a-z0-9._-]{3,32}$/.test(username) || password.length < 8 || password.length > 128) {
      return json({ error: "Usuario o contraseña incorrectos." }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const publishableKey = readPublishableKey();
    if (!url || !publishableKey) return json({ error: "Servicio de autenticación no configurado." }, 503);

    // Cloudflare supplies CF-Connecting-IP; combine it with the username so
    // attempts are isolated per account and source without exposing that data.
    const ip = request.headers.get("CF-Connecting-IP") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const attemptKey = await sha256(username + "|" + ip);
    const lookup = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await lookup.rpc("username_login_lookup", {
      p_username: username,
      p_key_hash: attemptKey
    });
    if (error) {
      console.error("username-login lookup failed", error);
      return json({ error: "No se pudo validar el usuario." }, 503);
    }
    const result = data?.[0];
    if (!result?.allowed) return json({ error: "Demasiados intentos. Probá nuevamente en 15 minutos." }, 429);
    const email = result.email;
    if (!email) return json({ error: "Usuario o contraseña incorrectos." }, 400);

    const authResponse = await fetch(url.replace(/\/+$/, "") + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    if (!authResponse.ok) return json({ error: "Usuario o contraseña incorrectos." }, 400);
    return json(await authResponse.json());
  } catch (error) {
    console.error("username-login failure", error);
    return json({ error: "No se pudo iniciar sesión." }, 500);
  }
});
