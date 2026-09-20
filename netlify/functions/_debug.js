import { createClient } from "@supabase/supabase-js";

export default async (event) => {
  const q = (event.queryStringParameters || {});
  const headerToken = String((event.headers && event.headers.authorization) || "");
  const queryToken = String(q.token || "");
  const token = queryToken || headerToken.replace(/^Bearer\s+/i, "");
  let getUser = "not-tried";
  try {
    const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { data, error } = await anon.auth.getUser(token);
    getUser = error ? `ERROR ${error.status} ${error.message}` : `OK ${(data.user || {}).email}`;
  } catch (e) {
    getUser = "THREW " + e.message;
  }
  return new Response(JSON.stringify({
    query_keys: Object.keys(q),
    token_len: token.length,
    from: queryToken ? "query" : headerToken ? "header" : "none",
    getUser
  }), { status: 200, headers: { "Content-Type": "application/json" } });
};