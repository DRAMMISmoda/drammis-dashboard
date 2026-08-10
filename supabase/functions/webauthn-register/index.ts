import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
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

async function getUserFromAuthHeader(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const user = await getUserFromAuthHeader(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "not_authenticated" }), { status: 401, headers: corsHeaders });
    }

    const body = await req.json();

    if (body.action === "options") {
      const options = await generateRegistrationOptions({
        rpName: "DRAMMIS",
        rpID: RP_ID,
        userID: user.id,
        userName: user.email ?? "admin",
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "required",
        },
      });

      // Costruiamo un oggetto nuovo e pulito per la risposta invece di
      // modificare quello della libreria (potrebbe avere getter/campi
      // interni che ignorano un'assegnazione diretta).
      const safeOptions = {
        ...options,
        user: {
          ...options.user,
          id: toBase64Url(new TextEncoder().encode(user.id)),
        },
      };

      await supabase.from("webauthn_challenges").insert({
        user_id: user.id,
        email: user.email,
        challenge: safeOptions.challenge,
      });

      return new Response(JSON.stringify(safeOptions), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (body.action === "verify") {
      const { data: challengeRow } = await supabase
        .from("webauthn_challenges")
        .select("challenge")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!challengeRow) {
        return new Response(JSON.stringify({ verified: false, error: "no_challenge" }), { status: 400, headers: corsHeaders });
      }

      const verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return new Response(JSON.stringify({ verified: false }), { status: 400, headers: corsHeaders });
      }

      // La forma esatta di registrationInfo varia tra versioni della libreria
      // (a volte campi piatti in bytes, a volte annidati sotto "credential" e
      // già come stringa) — gestiamo entrambe invece di assumerne una sola.
      const info: any = verification.registrationInfo;
      const rawId = info.credentialID ?? info.credential?.id;
      const rawPublicKey = info.credentialPublicKey ?? info.credential?.publicKey;
      const rawCounter = info.counter ?? info.credential?.counter ?? 0;

      function toBase64UrlAny(v: any): string {
        if (typeof v === "string") return v;
        if (v instanceof Uint8Array) return toBase64Url(v);
        if (v && typeof v.length === "number") return toBase64Url(new Uint8Array(v));
        return "";
      }

      const credentialIdStr = toBase64UrlAny(rawId);
      const publicKeyStr = toBase64UrlAny(rawPublicKey);

      if (!credentialIdStr || !publicKeyStr) {
        console.error("registrationInfo shape unexpected:", JSON.stringify(info));
        return new Response(JSON.stringify({ verified: false, error: "unexpected_shape" }), { status: 500, headers: corsHeaders });
      }

      const { error: insertErr } = await supabase.from("webauthn_credentials").insert({
        user_id: user.id,
        credential_id: credentialIdStr,
        public_key: publicKeyStr,
        counter: rawCounter,
        device_label: req.headers.get("user-agent")?.slice(0, 120) || null,
      });

      if (insertErr) {
        console.error("webauthn_credentials insert error:", insertErr);
        return new Response(JSON.stringify({ verified: false, error: "save_failed" }), { status: 500, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ verified: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
