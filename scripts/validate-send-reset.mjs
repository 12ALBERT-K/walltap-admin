// Throwaway validation for send-reset.js. Creates a temp admin + temp target,
// exercises the auth gate and the happy path, then removes both.
//
//   node scripts/validate-send-reset.mjs
//
// Needs SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in the
// environment (the chat app's .env works). Creates and deletes real auth users
// in the target project, so point it somewhere disposable.
import { createClient } from "@supabase/supabase-js";
import sendReset from "../netlify/functions/send-reset.js";

const url = process.env.SUPABASE_URL || process.env.URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !service || !anonKey) {
  console.log("missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY");
  process.exit(1);
}
// send-reset.js reads CHAT_APP_URL from the environment.
process.env.CHAT_APP_URL = process.env.CHAT_APP_URL || "http://localhost:3000";

const admin = createClient(url, service, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (cond, m) => { cond ? (pass++, console.log("  PASS  " + m)) : (fail++, console.log("  FAIL  " + m)); };

const call = (over = {}) => sendReset({
  httpMethod: "POST", headers: {}, body: "{}", ...over,
});

const tokenFor = async (email, password) => {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.session.access_token;
};

const stamp = Date.now();
const pw = "adm-" + stamp + "-pw";
const adminEmail = `admtest-${stamp}@walltap.test`;
const targetEmail = `tgt-${stamp}@walltap.test`;
let adminId, targetId;

try {
  const a = await admin.auth.admin.createUser({
    email: adminEmail, password: pw, email_confirm: true,
    user_metadata: { display_name: `admtest${stamp}` },
  });
  if (a.error) throw new Error("createUser(admin): " + a.error.message);
  adminId = a.data.user.id;
  await admin.from("profiles").update({ is_admin: true }).eq("id", adminId);

  const t = await admin.auth.admin.createUser({
    email: targetEmail, password: pw, email_confirm: true,
    user_metadata: { display_name: `tgt${stamp}` },
  });
  if (t.error) throw new Error("createUser(target): " + t.error.message);
  targetId = t.data.user.id;

  const adminToken = await tokenFor(adminEmail, pw);
  const targetToken = await tokenFor(targetEmail, pw);

  console.log("\nAuth gate");
  let res = await call();
  check(res.status === 401, `no token -> 401 (got ${res.status})`);

  res = await call({ headers: { authorization: `Bearer ${targetToken}` } });
  check(res.status === 403, `non-admin token -> 403 (got ${res.status})`);

  console.log("\nRequest validation");
  res = await call({ headers: { authorization: `Bearer ${adminToken}` }, httpMethod: "GET" });
  check(res.status === 405, `GET -> 405 (got ${res.status})`);

  res = await call({ headers: { authorization: `Bearer ${adminToken}` }, body: "{}" });
  check(res.status === 400, `missing userId -> 400 (got ${res.status})`);

  res = await call({ headers: { authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ userId: "not-a-uuid" }) });
  check(res.status === 400, `malformed userId -> 400 (got ${res.status})`);

  res = await call({
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ userId: "00000000-0000-4000-8000-000000000000" }),
  });
  check(res.status === 404, `unknown userId -> 404 (got ${res.status})`);

  res = await call({
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ userId: adminId }),
  });
  check(res.status === 400, `self-reset -> 400 (got ${res.status})`);

  console.log("\nHappy path");
  res = await call({
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ userId: targetId }),
  });
  const body = await res.clone().json();
  check(res.status === 200, `reset link issued -> 200 (got ${res.status}: ${JSON.stringify(body)})`);
  check(typeof body.actionLink === "string" && body.actionLink.includes("token="),
    "actionLink carries a token");
  check(body.actionLink.includes("type=recovery"), "actionLink is a recovery link");
  check(body.synthetic === false, `real email reported as non-synthetic (got ${body.synthetic})`);

  const ev = await admin.from("events").select("event_type").eq("user_id", targetId)
    .eq("event_type", "password_reset_issued");
  check((ev.data || []).length === 1, "password_reset_issued was logged");

  console.log(`\n${fail ? fail + " FAILED" : "all passed"} — ${pass} passed, ${fail} failed\n`);
} catch (e) {
  console.log("\nharness error: " + e.message);
  fail++;
} finally {
  for (const id of [adminId, targetId]) {
    if (!id) continue;
    await admin.from("events").delete().eq("user_id", id);
    await admin.auth.admin.deleteUser(id);
  }
  console.log("  (cleaned up temp users)");
}
process.exit(fail ? 1 : 0);
