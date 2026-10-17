import { createClient } from "@supabase/supabase-js";

// Service-role client — bypasses RLS. NEVER expose this to the browser.
export function adminClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// These functions are ESM with a default export, which Netlify runs as
// Functions v2: the handler receives a web `Request`, whose headers are a
// `Headers` instance and whose body is a stream. Reading v1 fields
// (`event.headers.authorization`, `event.httpMethod`, `event.body`) therefore
// ALWAYS came back undefined and every privileged call 401'd. The helpers
// below accept either shape, so the code keeps working either way.
export function getHeader(event, name) {
  const h = (event && event.headers) || {};
  if (typeof h.get === "function") return h.get(name) || "";
  const target = String(name).toLowerCase();
  for (const k of Object.keys(h)) if (k.toLowerCase() === target) return h[k] || "";
  return "";
}

export function getMethod(event) {
  return String((event && (event.method || event.httpMethod)) || "").toUpperCase();
}

export async function getJsonBody(event) {
  if (!event) return {};
  if (typeof event.json === "function") {
    try { return await event.json(); } catch { return {}; }
  }
  try { return JSON.parse((event && event.body) || "{}"); } catch { return {}; }
}

// Verifies the caller's JWT and checks is_admin=TRUE server-side.
// Every privileged function must call this before returning data.
export async function requireAdmin(event) {
  const token = getHeader(event, "authorization").replace(/^Bearer\s+/i, "");
  if (!token) throw httpError(401, "Authentication required.");

  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data.user) throw httpError(401, "Authentication required.");

  const db = adminClient();
  const { data: profile } = await db
    .from("profiles")
    .select("id, is_admin")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!profile || !profile.is_admin) throw httpError(403, "Admins only.");

  return { user: data.user, db };
}

export function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

export function fail(err) {
  const status = err && err.status ? err.status : 500;
  const message = status === 500 ? "Internal server error." : err.message;
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}