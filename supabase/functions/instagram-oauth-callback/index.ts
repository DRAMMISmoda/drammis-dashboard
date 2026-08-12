import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const APP_ID = Deno.env.get("INSTAGRAM_APP_ID")!;
const APP_SECRET = Deno.env.get("INSTAGRAM_APP_SECRET")!;
const REDIRECT_URI = "https://lyflfedxiosvayxjttzt.supabase.co/functions/v1/instagram-oauth-callback";
const DASHBOARD_URL = "https://drammis-dashboard.vercel.app";
const GRAPH = "https://graph.facebook.com/v21.0";

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    return Response.redirect(`${DASHBOARD_URL}/?instagram=error`, 302);
  }

  const tokenPromise = fetch(
    `${GRAPH}/oauth/access_token?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&client_secret=${APP_SECRET}&code=${code}`
  );

  const [tokenRes, adminResult] = await Promise.all([
    tokenPromise,
    supabase.from("admins").select("user_id").eq("user_id", state).maybeSingle(),
  ]);

  if (!adminResult.data) {
    return Response.redirect(`${DASHBOARD_URL}/?instagram=error`, 302);
  }

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    console.error("instagram token exchange failed", tokenData);
    return Response.redirect(`${DASHBOARD_URL}/?instagram=error`, 302);
  }

  let userToken = tokenData.access_token;
  try {
    const longRes = await fetch(
      `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${APP_ID}&client_secret=${APP_SECRET}&fb_exchange_token=${tokenData.access_token}`
    );
    const longData = await longRes.json();
    if (longRes.ok && longData.access_token) userToken = longData.access_token;
  } catch (_e) {
    // se fallisce lo scambio per il token lungo, resta valido comunque quello breve
  }

  const pagesRes = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${userToken}`
  );
  const pagesData = await pagesRes.json();
  if (!pagesRes.ok) {
    console.error("instagram pages fetch failed", pagesData);
    return Response.redirect(`${DASHBOARD_URL}/?instagram=error`, 302);
  }
  const pageWithIg = (pagesData.data || []).find((p: any) => p.instagram_business_account);

  if (!pageWithIg) {
    console.error("no instagram business account linked to any page", pagesData);
    return Response.redirect(`${DASHBOARD_URL}/?instagram=error`, 302);
  }

  const igUserId = pageWithIg.instagram_business_account.id;
  let igUsername: string | null = null;
  let avatarUrl: string | null = null;
  try {
    const igRes = await fetch(`${GRAPH}/${igUserId}?fields=username,profile_picture_url&access_token=${pageWithIg.access_token}`);
    const igData = await igRes.json();
    igUsername = igData.username || null;
    avatarUrl = igData.profile_picture_url || null;
  } catch (_e) {
    // non blocca il collegamento se il profilo non si legge
  }

  const { error: saveError } = await supabase.from("instagram_tokens").upsert({
    user_id: state,
    page_access_token: pageWithIg.access_token,
    page_id: pageWithIg.id,
    ig_user_id: igUserId,
    ig_username: igUsername,
    avatar_url: avatarUrl,
    updated_at: new Date().toISOString(),
  });

  if (saveError) {
    console.error("instagram_tokens save failed", saveError);
    return Response.redirect(`${DASHBOARD_URL}/?instagram=error`, 302);
  }

  return Response.redirect(`${DASHBOARD_URL}/?instagram=connected`, 302);
});
