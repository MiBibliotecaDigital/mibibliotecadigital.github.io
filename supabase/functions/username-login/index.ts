import { withSupabase } from "npm:@supabase/server@1";

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
      if (typeof parsed?.default === "string" && parsed.default) return parsed.default;
      const first = Object.values(parsed ?? {}).find((value) => typeof value === "string" && value);
      if (typeof first === "string") return first;
    } catch { return raw; }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
}

export default {
  fetch: withSupabase({ auth: "none" }, async (request, ctx) => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    try {
      const body = await request.json();
      const username = String(body?.username ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      if (!/^[a-z0-9._-]{3,32}$/.test(username) || password.length < 8 || password.length > 128) {
        return json({ error: "Usuario o contraseña incorrectos." }, 400);
      }

      const url = Deno.env.get("SUPABASE_URL");
      const publishableKey = readPublishableKey();
      if (!url || !publishableKey) return json({ error: "Servicio de autenticación no configurado." }, 503);

      // The server wrapper supplies the privileged client from the project's
      // secret-key environment dictionary. It is never sent to the browser.
      const admin = ctx.supabaseAdmin;
      if (!admin) return json({ error: "Servicio de autenticación no configurado." }, 503);
      const ip = request.headers.get("CF-Connecting-IP") ||
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const attemptKey = await sha256(username + "|" + ip);

      const { data: allowed, error: rateError } = await admin.rpc("consume_username_login_attempt", {
        p_key_hash: attemptKey
      });
      if (rateError) {
        console.error("username-login rate limit failed", rateError);
        return json({ error: "No se pudo validar el usuario." }, 503);
      }
      if (allowed !== true) return json({ error: "Demasiados intentos. Probá nuevamente en 15 minutos." }, 429);

      const { data: profile, error: profileError } = await admin.from("profiles")
        .select("id,status")
        .eq("username", username)
        .maybeSingle();
      if (profileError) {
        console.error("username-login profile lookup failed", profileError);
        return json({ error: "No se pudo validar el usuario." }, 503);
      }
      if (!profile || profile.status !== "active") {
        return json({ error: "Usuario o contraseña incorrectos." }, 400);
      }

      const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
      const email = userData?.user?.email;
      if (userError || !email) return json({ error: "Usuario o contraseña incorrectos." }, 400);

      const authResponse = await fetch(url.replace(/\/+$/, "") + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { apikey: publishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      if (!authResponse.ok) return json({ error: "Usuario o contraseña incorrectos." }, 400);

      await admin.rpc("clear_username_login_attempt", { p_key_hash: attemptKey });
      return json(await authResponse.json());
    } catch (error) {
      console.error("username-login failure", error);
      return json({ error: "No se pudo iniciar sesión." }, 500);
    }
  })
};
