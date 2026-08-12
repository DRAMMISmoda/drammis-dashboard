import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const CLIENT_KEY = Deno.env.get("TIKTOK_CLIENT_KEY")!;
const CLIENT_SECRET = Deno.env.get("TIKTOK_CLIENT_SECRET")!;

async function getCaller(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: admin } = await supabaseAdmin.from("admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!admin) return null;
  return data.user;
}

async function getAccessToken(userId: string): Promise<string | null> {
  const { data: row } = await supabaseAdmin.from("tiktok_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!row) return null;

  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  if (row.access_token && expiresAt > Date.now() + 60000) return row.access_token;

  const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    console.error("tiktok refresh failed", tokenData);
    return null;
  }

  await supabaseAdmin.from("tiktok_tokens").update({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || row.refresh_token,
    access_token_expires_at: new Date(Date.now() + (tokenData.expires_in || 86400) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);

  return tokenData.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const user = await getCaller(req);
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const body = await req.json();
    const action = body.action;

    if (action === "status") {
      const { data: row } = await supabaseAdmin.from("tiktok_tokens").select("display_name, avatar_url, created_at").eq("user_id", user.id).maybeSingle();
      return new Response(JSON.stringify({ connected: !!row, displayName: row?.display_name || null, avatarUrl: row?.avatar_url || null }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "disconnect") {
      await supabaseAdmin.from("tiktok_tokens").delete().eq("user_id", user.id);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accessToken = await getAccessToken(user.id);
    if (!accessToken) return new Response(JSON.stringify({ error: "not_connected" }), { status: 400, headers: corsHeaders });

    if (action === "profile") {
      const res = await fetch(
        "https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url,follower_count,following_count,likes_count,video_count",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      const profile = data?.data?.user || null;

      if (profile) {
        const today = new Date().toISOString().slice(0, 10);
        await supabaseAdmin.from("social_snapshots").upsert({
          platform: "tiktok",
          snapshot_date: today,
          follower_count: profile.follower_count ?? null,
          following_count: profile.following_count ?? null,
          likes_count: profile.likes_count ?? null,
          video_count: profile.video_count ?? null,
        }, { onConflict: "platform,snapshot_date" });
      }

      return new Response(JSON.stringify({ profile }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "snapshots") {
      const { data } = await supabaseAdmin
        .from("social_snapshots")
        .select("snapshot_date, follower_count, following_count, likes_count, video_count")
        .eq("platform", "tiktok")
        .order("snapshot_date", { ascending: true })
        .limit(90);
      return new Response(JSON.stringify({ snapshots: data || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "videos") {
      const res = await fetch(
        "https://open.tiktokapis.com/v2/video/list/?fields=id,title,cover_image_url,share_url,view_count,like_count,comment_count,share_count,create_time",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ max_count: 20 }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      return new Response(JSON.stringify({ videos: data?.data?.videos || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: corsHeaders });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
