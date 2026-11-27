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
  const username = String(value ?? "").trim().toLowerCase();
  return username || null;
};
const validUsername = (value: string | null) => value === null || /^[a-z0-9._-]{3,32}$/.test(value);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "Login required" }, 401);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;
    if (!url || !anonKey || !secretKey) return json({ error: "Server credentials are not configured" }, 503);

    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await caller.auth.getUser();
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    // The caller JWT is used for profile reads and all RPC writes. This makes
    // the database verify the admin role using its own RLS/SECURITY DEFINER rules.
    const { data: actor, error: actorError } = await caller.from("profiles")
      .select("id,role,status")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (actorError) {
      console.error("admin-users actor profile read failed", actorError);
      return json({ error: "Could not verify administrator profile" }, 502);
    }
    if (actor?.role !== "admin" || actor?.status !== "active") {
      return json({ error: "Administrator permission required" }, 403);
    }

    // This client is deliberately used only for Supabase Auth Admin operations.
    const authAdmin = createClient(url, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const body = await request.json();
    const action = String(body?.action ?? "");

    if (action === "list") {
      const [{ data: authUsers, error: listError }, { data: profiles, error: profileError }] = await Promise.all([
        authAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        caller.from("profiles").select("id,full_name,username,role,status,created_at").order("created_at", { ascending: false })
      ]);
      if (listError) {
        console.error("admin-users Auth list failed", listError);
        return json({ error: "Could not list Auth users: " + listError.message }, 502);
      }
      if (profileError) {
        console.error("admin-users profiles list failed", profileError);
        return json({ error: "Could not load profiles: " + profileError.message }, 502);
      }
      const byId = new Map((authUsers?.users ?? []).map((user) => [user.id, user]));
      return json({ users: (profiles ?? []).map((profile) => ({
        id: profile.id,
        name: profile.full_name || "",
        username: profile.username || "",
        email: byId.get(profile.id)?.email || "",
        role: profile.role,
        status: profile.status
      })) });
    }

    if (action === "create") {
      const fullName = String(body?.fullName ?? "").trim().slice(0, 120);
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      const username = normalizeUsername(body?.username);
      const role = String(body?.role ?? "reader");
      if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          password.length < 8 || password.length > 128 || !validUsername(username) ||
          !["reader", "editor", "admin"].includes(role)) {
        return json({ error: "Revisá nombre, email, username, contraseña y rol." }, 400);
      }
      const { data: created, error: createError } = await authAdmin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName }
      });
      if (createError || !created.user) return json({ error: createError?.message || "Could not create user" }, 400);
      const { error: profileError } = await caller.rpc("admin_manage_profile", {
        p_user_id: created.user.id,
        p_full_name: fullName,
        p_username: username,
        p_role: role,
        p_status: "active",
        p_update_username: true
      });
      if (profileError) {
        await authAdmin.auth.admin.deleteUser(created.user.id);
        return json({ error: profileError.message }, 400);
      }
      return json({ ok: true, user: { id: created.user.id, email, username, role } }, 201);
    }

    if (action === "update") {
      const userId = String(body?.userId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "Invalid user" }, 400);
      const { data: updated, error: updateError } = await caller.rpc("admin_manage_profile", {
        p_user_id: userId,
        p_full_name: body.fullName === undefined ? null : String(body.fullName).trim().slice(0, 120),
        p_username: body.username === undefined ? null : normalizeUsername(body.username),
        p_role: body.role === undefined ? null : String(body.role),
        p_status: body.status === undefined ? null : String(body.status),
        p_update_username: body.username !== undefined
      });
      if (updateError) {
        console.error("admin-users profile update failed", updateError);
        return json({ error: updateError.message }, 400);
      }
      return json({ ok: true, profile: updated });
    }

    if (action === "delete") {
      const userId = String(body?.userId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(userId)) return json({ error: "Invalid user" }, 400);
      const { error: guardError } = await caller.rpc("admin_assert_user_deletable", { p_user_id: userId });
      if (guardError) return json({ error: guardError.message }, 400);
      const { error: deleteError } = await authAdmin.auth.admin.deleteUser(userId);
      if (deleteError) return json({ error: deleteError.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("admin-users failure", error);
    return json({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
