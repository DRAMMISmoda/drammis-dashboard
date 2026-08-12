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
const GRAPH = "https://graph.facebook.com/v21.0";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const user = await getCaller(req);
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const body = await req.json();
    const action = body.action;

    const { data: row } = await supabaseAdmin.from("instagram_tokens").select("*").eq("user_id", user.id).maybeSingle();

    if (action === "status") {
      return new Response(JSON.stringify({ connected: !!row, username: row?.ig_username || null, avatarUrl: row?.avatar_url || null }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "disconnect") {
      await supabaseAdmin.from("instagram_tokens").delete().eq("user_id", user.id);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!row) return new Response(JSON.stringify({ error: "not_connected" }), { status: 400, headers: corsHeaders });
    const token = row.page_access_token;
    const igUserId = row.ig_user_id;

    if (action === "profile") {
      const res = await fetch(`${GRAPH}/${igUserId}?fields=username,followers_count,follows_count,media_count,profile_picture_url&access_token=${token}`);
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));

      const today = new Date().toISOString().slice(0, 10);
      await supabaseAdmin.from("social_snapshots").upsert({
        platform: "instagram",
        snapshot_date: today,
        follower_count: data.followers_count ?? null,
        following_count: data.follows_count ?? null,
        likes_count: null,
        video_count: data.media_count ?? null,
      }, { onConflict: "platform,snapshot_date" });

      return new Response(JSON.stringify({ profile: data }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "snapshots") {
      const { data } = await supabaseAdmin
        .from("social_snapshots")
        .select("snapshot_date, follower_count, following_count, likes_count, video_count")
        .eq("platform", "instagram")
        .order("snapshot_date", { ascending: true })
        .limit(90);
      return new Response(JSON.stringify({ snapshots: data || [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "media") {
      const res = await fetch(
        `${GRAPH}/${igUserId}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=20&access_token=${token}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));

      const items = data.data || [];
      await Promise.all(items.map(async (m: any) => {
        try {
          const insRes = await fetch(`${GRAPH}/${m.id}/insights?metric=reach&access_token=${token}`);
          const insData = await insRes.json();
          m.reach = insData?.data?.[0]?.values?.[0]?.value ?? null;
        } catch (_e) {
          m.reach = null;
        }
      }));

      return new Response(JSON.stringify({ media: items }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: corsHeaders });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
