import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CLIENT_KEY = Deno.env.get("TIKTOK_CLIENT_KEY")!;
const CLIENT_SECRET = Deno.env.get("TIKTOK_CLIENT_SECRET")!;
const REDIRECT_URI = "https://lyflfedxiosvayxjttzt.supabase.co/functions/v1/tiktok-oauth-callback";
const DASHBOARD_URL = "https://drammis-dashboard.vercel.app";

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    return Response.redirect(`${DASHBOARD_URL}/?tiktok=error`, 302);
  }

  // scambia il codice SUBITO, in parallelo al controllo admin: i codici TikTok durano pochissimo
  const tokenPromise = fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: CLIENT_KEY,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
    }),
  });

  const [tokenRes, adminResult] = await Promise.all([
    tokenPromise,
    supabase.from("admins").select("user_id").eq("user_id", state).maybeSingle(),
  ]);

  if (!adminResult.data) {
    return Response.redirect(`${DASHBOARD_URL}/?tiktok=error`, 302);
  }

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    console.error("tiktok token exchange failed", tokenData);
    return Response.redirect(`${DASHBOARD_URL}/?tiktok=error`, 302);
  }

  let displayName: string | null = null;
  let avatarUrl: string | null = null;
  try {
    const infoRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const infoData = await infoRes.json();
    displayName = infoData?.data?.user?.display_name || null;
    avatarUrl = infoData?.data?.user?.avatar_url || null;
  } catch (_e) {
    // non blocca il collegamento se il profilo non si legge
  }

  await supabase.from("tiktok_tokens").upsert({
    user_id: state,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    access_token_expires_at: new Date(Date.now() + (tokenData.expires_in || 86400) * 1000).toISOString(),
    open_id: tokenData.open_id,
    display_name: displayName,
    avatar_url: avatarUrl,
    updated_at: new Date().toISOString(),
  });

  return Response.redirect(`${DASHBOARD_URL}/?tiktok=connected`, 302);
});
