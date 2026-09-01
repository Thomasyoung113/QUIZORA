import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/game";
import { resolveAvatarUrl } from "../route";

export const dynamic = "force-dynamic";

const MAX_BYTES = 500 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

/** POST /api/profile/avatar-upload — store a resized avatar for the signed-in user. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "Only PNG, JPEG or WebP allowed" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large (max 500KB)" }, { status: 400 });
  }

  const db = serviceClient();

  // Ensure the bucket exists (public read, no client writes).
  const { data: buckets } = await db.storage.listBuckets();
  if (!buckets?.some((b) => b.name === "avatars")) {
    const { error: createErr } = await db.storage.createBucket("avatars", { public: true, fileSizeLimit: MAX_BYTES });
    if (createErr) return NextResponse.json({ error: "Could not create storage bucket" }, { status: 500 });
  }

  const path = `${user.id}/avatar-${Date.now()}.png`;
  const { error: uploadErr } = await db.storage
    .from("avatars")
    .upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (uploadErr) return NextResponse.json({ error: "Upload failed" }, { status: 500 });

  const { data } = db.storage.from("avatars").getPublicUrl(path);
  const publicUrl = data.publicUrl;

  const { error: updateErr } = await db
    .from("profiles")
    .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (updateErr) return NextResponse.json({ error: "Could not save avatar" }, { status: 500 });

  return NextResponse.json({ avatarUrl: resolveAvatarUrl({ avatar_url: publicUrl }), raw: publicUrl });
}
