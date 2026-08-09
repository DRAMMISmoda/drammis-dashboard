import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "npm:@simplewebauthn/server@9";

// Deve combaciare con il dominio reale di drammis-dashboard.
const RP_ID = "drammis-dashboard.vercel.app";
const ORIGIN = "https://drammis-dashboard.vercel.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(b64url.length + ((4 - (b64url.length % 4)) % 4), "=");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function findUserByEmail(email: string) {
  // Va bene per un numero ridotto di account (uso interno); se in futuro gli
  // utenti registrati diventano moltissimi andrà rivista con una query mirata.
  let page = 1;
  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users?.length) break;
    const match = data.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 1000) break;
    page++;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const body = await req.json();
    const email = (body.email || "").trim();
    if (!email) return new Response(JSON.stringify({ error: "missing_email" }), { status: 400, headers: corsHeaders });

    if (body.action === "options") {
      const user = await findUserByEmail(email);
      if (!user) {
        return new Response(JSON.stringify({ error: "no_passkey" }), { status: 404, headers: corsHeaders });
      }

      const { data: creds } = await supabase.from("webauthn_credentials").select("credential_id").eq("user_id", user.id);
      if (!creds || !creds.length) {
        return new Response(JSON.stringify({ error: "no_passkey" }), { status: 404, headers: corsHeaders });
      }

      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        userVerification: "required",
        allowCredentials: creds.map((c) => ({ id: c.credential_id, type: "public-key" as const })),
      });

      await supabase.from("webauthn_challenges").insert({ user_id: user.id, email, challenge: options.challenge });

      return new Response(JSON.stringify(options), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (body.action === "verify") {
      const user = await findUserByEmail(email);
      if (!user) return new Response(JSON.stringify({ verified: false }), { status: 400, headers: corsHeaders });

      const { data: challengeRow } = await supabase
        .from("webauthn_challenges")
        .select("challenge")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const credentialId = body.credential?.id;
      const { data: credRow } = await supabase
        .from("webauthn_credentials")
        .select("*")
        .eq("user_id", user.id)
        .eq("credential_id", credentialId)
        .maybeSingle();

      if (!challengeRow || !credRow) {
        return new Response(JSON.stringify({ verified: false }), { status: 400, headers: corsHeaders });
      }

      const verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        authenticator: {
          credentialID: fromBase64Url(credRow.credential_id),
          credentialPublicKey: fromBase64Url(credRow.public_key),
          counter: Number(credRow.counter),
        },
      });

      if (!verification.verified) {
        return new Response(JSON.stringify({ verified: false }), { status: 400, headers: corsHeaders });
      }

      await supabase.from("webauthn_credentials").update({ counter: verification.authenticationInfo.newCounter }).eq("id", credRow.id);

      // La firma WebAuthn è verificata: generiamo un token per aprire una vera
      // sessione Supabase, senza inviare nessuna email — lo scambia subito il client.
      const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({ type: "magiclink", email });
      if (linkErr || !linkData?.properties?.hashed_token) {
        return new Response(JSON.stringify({ verified: true, session_error: true }), { status: 200, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ verified: true, token_hash: linkData.properties.hashed_token }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
