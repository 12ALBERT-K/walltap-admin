// Walltap admin — vanilla JS, no build step.
// Wrapped in an IIFE, for the same reason public/app.js in the chat app is:
// the Supabase CDN bundle declares a GLOBAL `var supabase`, and a top-level
// `const supabase` here is a duplicate declaration → SyntaxError at PARSE time
// → the entire file is dead (no listeners, login button inert). Scoping the
// file inside a function keeps its bindings out of the global namespace.
(function () {
const SUPABASE_URL = window.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "";
const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const $ = (id) => document.getElementById(id);
const authBox  = $("auth");
const appEl    = $("app");
const deniedEl = $("denied");
const errEl    = $("auth-err");

let accessToken = null;
let isAdmin = false;

async function api(path, opts = {}) {
  const { method = "GET", body = null, retry = true } = opts;
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`/.netlify/functions/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  // Supabase access tokens expire ~1h. Refresh once and replay, otherwise a
  // dashboard left open silently starts 401ing and looks like empty data.
  if (res.status === 401 && retry && supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session && data.session.access_token !== accessToken) {
      accessToken = data.session.access_token;
      return api(path, { method, body, retry: false });
    }
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || `Error ${res.status}`);
  return payload;
}

// Every panel load is fire-and-forget; without this a failure became an
// unhandled rejection and the admin saw stale/empty content with no error.
function guard(promise, where) {
  return promise.catch(err => {
    console.error(where, err);
    const el = document.querySelector(".panel.active .card");
    if (el) el.insertAdjacentHTML("afterbegin",
      `<div class="err-text">${escapeHtml(err.message || "Failed to load.")}</div>`);
  });
}

function renderPanel(name, html) {
  document.querySelectorAll(".tabs button").forEach(b =>
    b.classList.toggle("active", b.dataset.panel === name));
  document.querySelectorAll(".panel").forEach(p =>
    p.classList.toggle("active", p.id === name));
  $(name).innerHTML = html;
}

function bars(data, labelKey = "day") {
  const counts = data.map(d => Number(d.count) || 0);
  const max = Math.max(1, ...counts);
  return `<div class="axis">${data.map((d, i) => {
    // event_type is written straight from the browser (events insert own allows
    // any authenticated user to set it), so it is untrusted input and MUST be
    // escaped here — renderPanel assigns this to innerHTML.
    const raw = String(d[labelKey] ?? "");
    const shown = labelKey === "day" ? raw.slice(5) : raw;
    return `
    <div style="flex-basis:40px">
      <div class="bar" style="height:${Math.round((counts[i] / max) * 110)}px"
           title="${escapeHtml(raw.slice(0, 60))} · ${counts[i]}"></div>
      <div class="label">${escapeHtml(shown.slice(0, 14))}</div>
    </div>`;
  }).join("")}</div>`;
}

async function loadOverview() {
  const s = await api("analytics-summary");
  renderPanel("overview", `
    <div class="card stats">
      <div class="stat"><div class="num">${s.total_users}</div><div class="lbl">Users</div></div>
      <div class="stat"><div class="num">${s.total_messages}</div><div class="lbl">Messages</div></div>
      <div class="stat"><div class="num">${s.active_users_last_30d}</div><div class="lbl">Active in 30d</div></div>
      <div class="stat"><div class="num">${(s.eventsByDay || []).reduce((a, e) => a + e.count, 0)}</div><div class="lbl">Events / ${s.days}d</div></div>
    </div>
    <div class="card"><h2>Posts per day (last ${s.days} days)</h2>${bars(s.postsByDay)}</div>
    <div class="card"><h2>Events by type per day</h2>${bars(s.eventsByDay, "event_type")}</div>`);
}

async function loadUsers() {
  const rows = await api("list-users");
  renderPanel("users", `
    <div class="card"><table>
      <thead><tr><th>Username</th><th>Role</th><th>Joined</th><th>Account</th><th>Recovery</th></tr></thead>
      <tbody>${rows.map(u => `
        <tr>
          <td>${escapeHtml(u.username)}</td>
          <td>${u.is_admin ? '<span class="badge admin">admin</span>' : '<span class="badge user">user</span>'}</td>
          <td>${new Date(u.created_at).toLocaleString()}</td>
          <td class="msg-text">${escapeHtml(u.email)}${isSynthetic(u.email)
            ? '<br><span class="badge user">username login</span>' : ""}</td>
          <td><button class="btn-reset" data-uid="${escapeHtml(u.id)}"
              data-name="${escapeHtml(u.username)}">Reset link</button></td>
        </tr>`).join("")}</tbody>
    </table></div>`);
  document.querySelectorAll(".btn-reset").forEach(btn =>
    btn.addEventListener("click", () => issueReset(btn)));
}

function isSynthetic(email) {
  return String(email || "").toLowerCase().endsWith("@walltap.local");
}

// A recovery link is a live credential, so it is shown once, never stored, and
// the panel closes on the next render.
async function issueReset(btn) {
  const uid  = btn.dataset.uid;
  const name = btn.dataset.name;
  if (!confirm(`Generate a password-reset link for "${name}"?\n\n`
    + "The link works once and expires. You will have to send it to them "
    + "yourself — the app cannot email it.")) return;

  btn.disabled = true;
  btn.textContent = "Working…";
  try {
    const res = await api("send-reset", { method: "POST", body: { userId: uid } });
    if (!res.actionLink) throw new Error("Supabase returned no link.");
    showResetResult(name, res);
  } catch (err) {
    alert(`Could not create a reset link: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Reset link";
  }
}

function showResetResult(name, res) {
  const note = res.synthetic
    ? `"${name}" signed up with a username, so there is no inbox. Send this link to them directly.`
    : `"${name}" has a real email address — Supabase can also send a reset email, but sending the link yourself is more reliable.`;
  const existing = document.getElementById("reset-result");
  if (existing) existing.remove();

  const box = document.createElement("div");
  box.id = "reset-result";
  box.className = "card";
  box.innerHTML = `
    <h3>Reset link for ${escapeHtml(name)}</h3>
    <p class="note">${escapeHtml(note)}</p>
    <div class="link-row">
      <input type="text" class="link-box" readonly value="${escapeHtml(res.actionLink)}" />
      <button class="btn-copy">Copy</button>
    </div>`;
  document.getElementById("users").prepend(box);

  const input = box.querySelector(".link-box");
  box.querySelector(".btn-copy").addEventListener("click", async (e) => {
    input.select();
    try {
      await navigator.clipboard.writeText(res.actionLink);
      e.target.textContent = "Copied";
    } catch {
      document.execCommand("copy");
      e.target.textContent = "Copied";
    }
    setTimeout(() => { e.target.textContent = "Copy"; }, 1500);
  });
}

async function loadMessages() {
  const rows = await api("list-all-messages");
  renderPanel("messages", `
    <div class="card"><table>
      <thead><tr><th>When</th><th>Author</th><th>Message</th><th>Files</th><th>Status</th></tr></thead>
      <tbody>${rows.map(p => `
        <tr class="${p.deleted_at ? "deleted" : ""}">
          <td>${new Date(Number(p.timestamp)).toLocaleString()}</td>
          <td>${escapeHtml(p.author)}</td>
          <td class="msg-text">${escapeHtml(p.text || "—")}</td>
          <td>${(p.files || []).map(f => escapeHtml(f.original)).join("<br>") || "—"}</td>
          <td>${p.deleted_at
            ? '<span class="badge deleted" title="Erased by the author ' +
              escapeHtml(new Date(p.deleted_at).toLocaleString()) + '">deleted</span>'
            : '<span class="badge live">live</span>'}</td>
        </tr>`).join("")}</tbody>
    </table></div>`);
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function enterAdmin() {
  deniedEl.style.display = "none";
  authBox.classList.add("hidden");
  appEl.style.display = "block";
  guard(loadOverview(), "overview");
}

// Guard: verify is_admin server-side before showing anything privileged.
async function checkSession() {
  if (!supabase) { errEl.textContent = "Supabase not configured."; return; }
  const { data } = await supabase.auth.getSession();
  if (!data.session) { authBox.classList.remove("hidden"); return; }
  accessToken = data.session.access_token;
  try {
    await api("list-users");
    isAdmin = true;
    enterAdmin();
  } catch (err) {
    if (err.message.includes("Admins only")) {
      deniedEl.style.display = "block";
      authBox.classList.add("hidden");
    } else {
      appEl.style.display = "block";
      renderPanel("overview", `<div class="card err-text">${escapeHtml(err.message)}</div>`);
    }
  }
}

$("login-btn").addEventListener("click", async () => {
  const email = $("email").value.trim();
  const password = $("password").value;
  errEl.textContent = "";
  if (!email || !password) { errEl.textContent = "Email and password are required."; return; }
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    accessToken = data.session.access_token;
    try {
      await api("list-users"); // server-side admin check
    } catch (err) {
      if (err.message.includes("Admins only")) {
        await supabase.auth.signOut();
        accessToken = null;
        errEl.textContent = "This account is not an admin.";
        return;
      }
      throw err;
    }
    enterAdmin();
  } catch (err) {
    errEl.textContent = err.message || "Something went wrong.";
  }
});

$("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut().catch(() => {});
  location.reload();
});

$("email").addEventListener("keydown", e => {
  if (e.key === "Enter") $("password").focus();
});
$("password").addEventListener("keydown", e => {
  if (e.key === "Enter") $("login-btn").click();
});

document.getElementById("tabs").addEventListener("click", e => {
  const btn = e.target.closest("button[data-panel]");
  if (!btn) return;
  const name = btn.dataset.panel;
  if (name === "overview") guard(loadOverview(), name);
  else if (name === "users") guard(loadUsers(), name);
  else if (name === "messages") guard(loadMessages(), name);
});

// Keep accessToken current for the life of the session (see api()'s 401 replay).
if (supabase) {
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) accessToken = session.access_token;
  });
}

checkSession();
})();