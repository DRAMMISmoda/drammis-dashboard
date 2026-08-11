import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const REDIRECT_URI = "https://lyflfedxiosvayxjttzt.supabase.co/functions/v1/gmail-oauth-callback";
const DASHBOARD_URL = "https://drammis-dashboard.vercel.app";

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error || !code || !state) {
    return Response.redirect(`${DASHBOARD_URL}/?gmail=error`, 302);
  }

  const { data: admin } = await supabase.from("admins").select("user_id").eq("user_id", state).maybeSingle();
  if (!admin) {
    return Response.redirect(`${DASHBOARD_URL}/?gmail=error`, 302);
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.refresh_token) {
    console.error("token exchange failed", tokenData);
    return Response.redirect(`${DASHBOARD_URL}/?gmail=error`, 302);
  }

  let googleEmail: string | null = null;
  try {
    const profileRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileRes.json();
    googleEmail = profile.emailAddress || null;
  } catch (_e) {
    // non blocca il collegamento se il profilo non si legge
  }

  await supabase.from("google_tokens").upsert({
    user_id: state,
    refresh_token: tokenData.refresh_token,
    access_token: tokenData.access_token,
    access_token_expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
    email: googleEmail,
    updated_at: new Date().toISOString(),
  });

  return Response.redirect(`${DASHBOARD_URL}/?gmail=connected`, 302);
});
