import { requireAdmin, ok, fail, getMethod, getJsonBody } from "./_shared/supabase.js";

// Issues a single-use password-reset link for one user.
//
// Passwords are bcrypt hashes, so a forgotten one cannot be recovered or
// forwarded — the only thing an admin can do is mint a fresh recovery link and
// hand it to the user out of band. That is what this does.
//
// generateLink() does NOT send an email. For username accounts the address is
// synthetic (username@walltap.local) and has no inbox, so delivery is always
// manual; the response says so via `synthetic` so the dashboard can warn.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SYNTHETIC_DOMAIN = "@walltap.local";

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

export default async (event) => {
  try {
    if (getMethod(event) !== "POST") throw httpError(405, "POST required.");

    const { user: adminUser, db } = await requireAdmin(event);

    const body = await getJsonBody(event);

    // Keyed on user id, never on an email from the client: accepting an email
    // would turn this into a user-enumeration oracle for any admin session.
    const userId = String(body.userId || "").trim();
    if (!UUID_RE.test(userId)) throw httpError(400, "A user id is required.");

    const { data: target, error: lookupErr } = await db
      .from("admin_profiles")
      .select("id, username, email")
      .eq("id", userId)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!target) throw httpError(404, "No such user.");

    if (target.id === adminUser.id) {
      throw httpError(400, "You cannot issue a reset link for your own account.");
    }

    // Must match an entry in Supabase → Auth → URL Configuration, otherwise the
    // verify call is rejected and the link dead-ends on an error page.
    const chatAppUrl = (process.env.CHAT_APP_URL || "").replace(/\/+$/, "");
    if (!chatAppUrl) {
      throw httpError(500, "CHAT_APP_URL is not set on this function.");
    }

    const { data: link, error: linkErr } = await db.auth.admin.generateLink({
      type: "recovery",
      email: target.email,
      options: { redirectTo: `${chatAppUrl}/?recovery=1` }
    });
    if (linkErr) throw httpError(502, linkErr.message || "Could not generate a reset link.");

    // Best-effort audit trail. The link itself is never logged.
    await db.from("events").insert({
      event_type: "password_reset_issued",
      user_id: target.id,
      metadata: { by: adminUser.id, username: target.username }
    });

    return ok({
      actionLink: link?.properties?.action_link || null,
      username: target.username,
      email: target.email,
      synthetic: String(target.email || "").toLowerCase().endsWith(SYNTHETIC_DOMAIN)
    });
  } catch (err) {
    return fail(err);
  }
};
