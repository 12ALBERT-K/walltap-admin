import { adminClient, requireAdmin, ok, fail } from "./_shared/supabase.js";

export default async (event) => {
  try {
    await requireAdmin(event);
    const db = adminClient();
    const { data, error } = await db
      .from("admin_profiles")
      .select("id, username, is_admin, email, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ok(data);
  } catch (err) {
    return fail(err);
  }
};