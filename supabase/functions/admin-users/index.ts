import { withSupabase } from "npm:@supabase/server@1";

const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" }
  });

const normalizeUsername = (value: unknown) => {
  const username = String(value ?? "").trim().toLowerCase();
  return username || null;
};
const validUsername = (value: string | null) =>
  value === null || /^[a-z0-9._-]{3,32}$/.test(value);

export default {
  fetch: withSupabase({ auth: "user" }, async (request, ctx) => {
    try {
      const caller = ctx.supabase;
      const admin = ctx.supabaseAdmin;
      const actorId = ctx.userClaims?.id;
      if (!caller || !admin || !actorId) {
        return json({ error: "No se pudo validar la sesión." }, 401);
      }

      const { data: actor, error: actorError } = await caller
        .from("profiles")
        .select("id,role,status")
        .eq("id", actorId)
        .maybeSingle();

      if (actorError) {
        console.error("admin-users actor profile read failed", actorError);
        return json({ error: "No se pudo verificar el perfil administrador." }, 502);
      }
      if (actor?.role !== "admin" || actor?.status !== "active") {
        return json({ error: "Se requiere una cuenta administradora activa." }, 403);
      }

      const body = await request.json();
      const action = String(body?.action ?? "");

      if (action === "list") {
        const { data: profiles, error } = await caller.rpc("admin_list_profiles");
        if (error) {
          console.error("admin-users secure profile list failed", error);
          return json({ error: error.message || "No se pudo cargar la lista de usuarios." }, 502);
        }
        return json({
          users: (profiles ?? []).map((profile) => ({
            id: profile.id,
            name: profile.full_name || "",
            username: profile.username || "",
            email: profile.email || "",
            role: profile.role,
            status: profile.status
          }))
        });
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
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName }
        });
        if (createError || !created.user) {
          return json({ error: createError?.message || "No se pudo crear el usuario." }, 400);
        }

        const { error: profileError } = await caller.rpc("admin_manage_profile", {
          p_user_id: created.user.id,
          p_full_name: fullName,
          p_username: username,
          p_role: role,
          p_status: "active",
          p_update_username: true
        });

        if (profileError) {
          await admin.auth.admin.deleteUser(created.user.id);
          return json({ error: profileError.message }, 400);
        }

        return json({
          ok: true,
          user: { id: created.user.id, email, username, role }
        }, 201);
      }

      if (action === "update") {
        const userId = String(body?.userId ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(userId)) {
          return json({ error: "Usuario inválido." }, 400);
        }
        const { data: updated, error } = await caller.rpc("admin_manage_profile", {
          p_user_id: userId,
          p_full_name: body.fullName === undefined ? null : String(body.fullName).trim().slice(0, 120),
          p_username: body.username === undefined ? null : normalizeUsername(body.username),
          p_role: body.role === undefined ? null : String(body.role),
          p_status: body.status === undefined ? null : String(body.status),
          p_update_username: body.username !== undefined
        });
        if (error) {
          console.error("admin-users profile update failed", error);
          return json({ error: error.message }, 400);
        }
        return json({ ok: true, profile: updated });
      }

      if (action === "delete") {
        const userId = String(body?.userId ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(userId)) {
          return json({ error: "Usuario inválido." }, 400);
        }
        const { error: guardError } = await caller.rpc("admin_assert_user_deletable", {
          p_user_id: userId
        });
        if (guardError) return json({ error: guardError.message }, 400);

        const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
        if (deleteError) return json({ error: deleteError.message }, 400);
        return json({ ok: true });
      }

      return json({ error: "Acción desconocida." }, 400);
    } catch (error) {
      console.error("admin-users failure", error);
      return json({
        error: error instanceof Error ? error.message : "Error interno del servidor."
      }, 500);
    }
  })
};
