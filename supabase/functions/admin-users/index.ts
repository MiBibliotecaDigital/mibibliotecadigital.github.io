import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const origin = Deno.env.get("APP_ORIGIN") ?? "https://mibibliotecadigital.github.io";
const headers = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-client-info",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Vary": "Origin"
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
const normalizeUsername = (value: unknown) => {
  const v = String(value ?? "").trim().toLowerCase();
  return v || null;
};
const validUsername = (value: string | null) => value === null || /^[a-z0-9._-]{3,32}$/.test(value);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Login required" }, 401);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await caller.auth.getUser();
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: actor } = await admin.from("profiles").select("role,status").eq("id", authData.user.id).maybeSingle();
    if (actor?.role !== "admin" || actor?.status !== "active") return json({ error: "Administrator permission required" }, 403);

    const body = await request.json();
    const action = String(body?.action ?? "");

    if (action === "list") {
      const { data: authUsers, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (listError) return json({ error: "Could not list users" }, 502);
      const { data: profiles, error: profileError } = await admin.from("profiles")
        .select("id,full_name,username,role,status,created_at")
        .order("created_at", { ascending: false });
      if (profileError) return json({ error: "Could not load profiles" }, 502);
      const byId = new Map((authUsers.users ?? []).map((u) => [u.id, u]));
      return json({ users: (profiles ?? []).map((p) => ({
        id: p.id,
        name: p.full_name || "",
        username: p.username || "",
        email: byId.get(p.id)?.email || "",
        role: p.role,
        status: p.status
      })) });
    }

    if (action === "create") {
      const fullName = String(body?.fullName ?? "").trim().slice(0, 120);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      const username = normalizeUsername(body?.username);
      const role = String(body?.role ?? "reader");
      if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          password.length < 8 || password.length > 128 ||
          !validUsername(username) || !["reader", "editor", "admin"].includes(role)) {
        return json({ error: "Revisá nombre, email, username, contraseña y rol." }, 400);
      }
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName }
      });
      if (createError || !created.user) return json({ error: createError?.message || "Could not create user" }, 400);
      const { error: updateError } = await admin.from("profiles").update({
        full_name: fullName, username, role, status: "active"
      }).eq("id", created.user.id);
      if (updateError) {
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: updateError.message }, 500);
      }
      return json({ ok: true, user: { id: created.user.id, email, username, role } }, 201);
    }

    if (action === "update") {
      const userId = String(body?.userId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "Invalid user" }, 400);
      const { data: target, error: targetError } = await admin.from("profiles")
        .select("id,role,status").eq("id", userId).maybeSingle();
      if (targetError || !target) return json({ error: "User not found" }, 404);
      const changes: Record<string, unknown> = {};
      if (body.fullName !== undefined) changes.full_name = String(body.fullName).trim().slice(0, 120);
      if (body.username !== undefined) {
        const username = normalizeUsername(body.username);
        if (!validUsername(username)) return json({ error: "Username inválido: usá 3–32 caracteres (letras, números, punto, guion o guion bajo)." }, 400);
        changes.username = username;
      }
      if (body.role !== undefined) {
        const role = String(body.role);
        if (!["reader", "editor", "admin"].includes(role)) return json({ error: "Invalid role" }, 400);
        changes.role = role;
      }
      if (body.status !== undefined) {
        const status = String(body.status);
        if (!["active", "suspended"].includes(status)) return json({ error: "Invalid status" }, 400);
        changes.status = status;
      }
      if (!Object.keys(changes).length) return json({ error: "No changes supplied" }, 400);
      if (userId === authData.user.id && ((changes.role && changes.role !== "admin") || changes.status === "suspended")) {
        return json({ error: "No podés quitarte tu propio acceso de administrador desde esta pantalla." }, 400);
      }
      if (target.role === "admin" && ((changes.role && changes.role !== "admin") || changes.status === "suspended")) {
        const { count } = await admin.from("profiles").select("id", { count: "exact", head: true })
          .eq("role", "admin").eq("status", "active");
        if ((count ?? 0) <= 1) return json({ error: "No se puede desactivar al último administrador activo." }, 400);
      }
      const { error: updateError } = await admin.from("profiles").update(changes).eq("id", userId);
      if (updateError) return json({ error: updateError.message }, 400);
      return json({ ok: true });
    }

    if (action === "delete") {
      const userId = String(body?.userId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "Invalid user" }, 400);
      if (userId === authData.user.id) return json({ error: "No podés eliminar tu propia cuenta desde la consola." }, 400);
      const { data: target } = await admin.from("profiles").select("id,role").eq("id", userId).maybeSingle();
      if (!target) return json({ error: "User not found" }, 404);
      if (target.role === "admin") {
        const { count } = await admin.from("profiles").select("id", { count: "exact", head: true })
          .eq("role", "admin").eq("status", "active");
        if ((count ?? 0) <= 1) return json({ error: "No se puede eliminar al último administrador activo." }, 400);
      }
      const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
      if (deleteError) return json({ error: deleteError.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("admin-users failure", error);
    return json({ error: "Internal server error" }, 500);
  }
});
