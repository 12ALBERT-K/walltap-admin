import { adminClient, requireAdmin, ok, fail } from "./_shared/supabase.js";

const DAYS = 30;

export default async (event) => {
  try {
    await requireAdmin(event);
    const db = adminClient();
    const since = new Date(Date.now() - DAYS * 86400000).toISOString();

    const [
      { count: userCount },
      { count: messageCount },
      { data: rawEvents, error: eventsErr },
      { data: recentPosts, error: recentErr }
    ] = await Promise.all([
      db.from("admin_profiles").select("id", { count: "exact", head: true }),
      db.from("posts").select("id", { count: "exact", head: true }),
      db.from("events").select("event_type, user_id, created_at").gte("created_at", since),
      db.from("posts").select("timestamp").order("timestamp", { ascending: false }).limit(200)
    ]);
    if (eventsErr) throw eventsErr;
    if (recentErr) throw recentErr;

    // events → { day, event_type, count }
    const trend = new Map();
    const activeUsers = new Set();
    for (const ev of rawEvents || []) {
      const day = ev.created_at.slice(0, 10);
      const key = `${day}|${ev.event_type}`;
      trend.set(key, (trend.get(key) || 0) + 1);
      if (ev.user_id) activeUsers.add(ev.user_id);
    }
    const eventsByDay = [...trend.entries()]
      .map(([key, count]) => {
        const [day, event_type] = key.split("|");
        return { day, event_type, count };
      })
      .sort((a, b) => a.day.localeCompare(b.day));

    // per-day post volume from post timestamps (includes legacy rows)
    const postsByDay = new Map();
    for (const p of recentPosts || []) {
      const ts = Number(p.timestamp);
      const day = new Date(ts).toISOString().slice(0, 10);
      postsByDay.set(day, (postsByDay.get(day) || 0) + 1);
    }

    return ok({
      days: DAYS,
      total_users: userCount,
      total_messages: messageCount,
      active_users_last_30d: activeUsers.size,
      eventsByDay,
      postsByDay: [...postsByDay.entries()]
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => a.day.localeCompare(b.day))
    });
  } catch (err) {
    return fail(err);
  }
};