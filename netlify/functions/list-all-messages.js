import { adminClient, requireAdmin, ok, fail } from "./_shared/supabase.js";

export default async (event) => {
  try {
    await requireAdmin(event);
    const db = adminClient();

    const [{ data: posts, error: postsErr }, { data: files, error: filesErr }] =
      await Promise.all([
        db.from("posts").select("*").order("timestamp", { ascending: false }),
        db.from("post_files").select("*")
      ]);
    if (postsErr) throw postsErr;
    if (filesErr) throw filesErr;

    const filesByPost = new Map();
    for (const f of files || []) {
      const list = filesByPost.get(f.post_id) || [];
      list.push(f);
      filesByPost.set(f.post_id, list);
    }

    const out = (posts || []).map(p => ({
      id: p.id,
      text: p.text,
      author: p.author,
      authorId: p.author_id,
      timestamp: p.timestamp,
      deleted_at: p.deleted_at || null,
      files: (filesByPost.get(p.id) || []).map(f => ({
        filename: f.file_name,
        original: f.file_original,
        size: f.file_size,
        mimetype: f.file_mimetype
      }))
    }));

    return ok(out);
  } catch (err) {
    return fail(err);
  }
};