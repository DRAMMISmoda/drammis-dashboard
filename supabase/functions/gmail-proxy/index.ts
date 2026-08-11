import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.32.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

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
  const { data: row } = await supabaseAdmin.from("google_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!row) return null;

  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  if (row.access_token && expiresAt > Date.now() + 60000) return row.access_token;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: row.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    console.error("refresh failed", tokenData);
    return null;
  }

  await supabaseAdmin.from("google_tokens").update({
    access_token: tokenData.access_token,
    access_token_expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);

  return tokenData.access_token;
}

function headerVal(headers: any[], name: string): string {
  const h = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return decodeURIComponent(escape(atob(base64)));
  } catch {
    return atob(base64);
  }
}

function findBodyPart(part: any): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBase64Url(part.body.data);
  if (part.parts) {
    for (const p of part.parts) {
      const found = findBodyPart(p);
      if (found) return found;
    }
  }
  if (part.mimeType === "text/html" && part.body?.data) return decodeBase64Url(part.body.data);
  if (part.body?.data) return decodeBase64Url(part.body.data);
  return "";
}

function toBase64Url(str: string): string {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function gmailFetch(accessToken: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API error ${res.status}: ${text}`);
  }
  return res.json();
}

const CATEGORY_SYSTEM_PROMPT = `Analizza queste email arrivate nella casella di DRAMMIS, un piccolo brand italiano di cinture in pelle. Per ciascuna decidi se è:
- "fornitori": email da chi vende materiali, produce, spedisce o fornisce servizi al brand (es. conceria, produttore fibbie, corriere, tipografia, commercialista, agenzia, piattaforma software/hosting, packaging)
- "importanti": qualsiasi altra email genuina che merita attenzione (nuovo cliente che scrive prima di un acquisto, richiesta di collaborazione, problema, banca, questioni legali, stampa/influencer, ecc)
Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo: le chiavi sono gli id delle email, i valori sono "fornitori" oppure "importanti".`;

async function classifyRemaining(items: { id: string; from: string; subject: string; snippet: string }[]): Promise<Record<string, string>> {
  if (!items.length) return {};
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: CATEGORY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: JSON.stringify(items.map((i) => ({ id: i.id, from: i.from, subject: i.subject, snippet: i.snippet }))) }],
    });
    const textBlock = response.content.find((b: any) => b.type === "text") as any;
    const parsed = JSON.parse((textBlock?.text || "{}").trim());
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.error("classifyRemaining failed", e);
    return {};
  }
}

async function listEmails(accessToken: string) {
  // esclude social/pubblicità/notifiche automatiche usando la classificazione che Gmail fa già da solo,
  // così restano solo email vere (persone che scrivono davvero) da smistare in clienti/fornitori/importanti
  const query = "in:inbox -category:social -category:promotions -category:updates -category:forums";
  const list = await gmailFetch(accessToken, `/messages?maxResults=30&q=${encodeURIComponent(query)}`);
  const ids = (list.messages || []).map((m: any) => m.id);
  const details = await Promise.all(
    ids.map((id: string) =>
      gmailFetch(accessToken, `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
    )
  );

  const [{ data: suppliers }, { data: orders }] = await Promise.all([
    supabaseAdmin.from("known_suppliers").select("email"),
    supabaseAdmin.from("orders").select("email"),
  ]);
  const supplierEmails = new Set((suppliers || []).map((s: any) => s.email.toLowerCase()));
  const customerEmails = new Set((orders || []).map((o: any) => (o.email || "").toLowerCase()));

  const parsed = details.map((d: any) => {
    const from = headerVal(d.payload.headers, "From");
    const match = from.match(/<([^>]+)>/);
    const fromEmail = (match ? match[1] : from).toLowerCase().trim();
    let category: string | null = null;
    if (customerEmails.has(fromEmail)) category = "clienti";
    else if (supplierEmails.has(fromEmail)) category = "fornitori";
    return {
      id: d.id,
      threadId: d.threadId,
      from,
      fromEmail,
      subject: headerVal(d.payload.headers, "Subject"),
      date: headerVal(d.payload.headers, "Date"),
      snippet: d.snippet,
      unread: (d.labelIds || []).includes("UNREAD"),
      category,
    };
  });

  // per le email che non corrispondono né a un cliente né a un fornitore già noto,
  // chiede all'AI di leggerne il contenuto e decidere fornitori/importanti
  const undetermined = parsed.filter((e) => !e.category);
  const aiCategories = await classifyRemaining(undetermined.map((e) => ({ id: e.id, from: e.from, subject: e.subject, snippet: e.snippet })));

  return parsed.map((e) => ({
    ...e,
    category: e.category || (aiCategories[e.id] === "fornitori" ? "fornitori" : "importanti"),
  }));
}

async function getEmail(accessToken: string, id: string) {
  const d = await gmailFetch(accessToken, `/messages/${id}?format=full`);
  return {
    id: d.id,
    threadId: d.threadId,
    from: headerVal(d.payload.headers, "From"),
    subject: headerVal(d.payload.headers, "Subject"),
    date: headerVal(d.payload.headers, "Date"),
    messageIdHeader: headerVal(d.payload.headers, "Message-ID"),
    body: findBodyPart(d.payload),
  };
}

async function sendReply(accessToken: string, threadId: string, toEmail: string, subject: string, body: string, inReplyTo: string) {
  const subj = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`;
  const mimeLines = [
    `To: ${toEmail}`,
    `Subject: ${subj}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    inReplyTo ? `References: ${inReplyTo}` : null,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    body,
  ].filter((l) => l !== null);
  const raw = toBase64Url(mimeLines.join("\r\n"));
  return gmailFetch(accessToken, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw, threadId }),
  });
}

const EMAIL_SYSTEM_PROMPT = `Sei l'assistente personale di Manuel, il fondatore di DRAMMIS (maison italiana di cinture). Lo aiuti a gestire la posta di info.drammis@gmail.com. Rispondi sempre in italiano, tono professionale, cordiale, diretto e conciso, come scriverebbe Manuel stesso a un cliente o fornitore. Non inventare mai informazioni su ordini, prezzi o policy che non conosci: se l'email richiede dati specifici che non hai, scrivi una risposta che chiede questi dettagli oppure rimanda a info.drammis@gmail.com. Quando proponi una bozza di risposta, scrivi SOLO il testo dell'email pronto da inviare, senza commenti tuoi prima o dopo.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const user = await getCaller(req);
    if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: corsHeaders });

    const body = await req.json();
    const action = body.action;

    if (action === "status") {
      const { data: row } = await supabaseAdmin.from("google_tokens").select("email, created_at").eq("user_id", user.id).maybeSingle();
      return new Response(JSON.stringify({ connected: !!row, email: row?.email || null }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "disconnect") {
      await supabaseAdmin.from("google_tokens").delete().eq("user_id", user.id);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (["list", "get", "send"].includes(action)) {
      const accessToken = await getAccessToken(user.id);
      if (!accessToken) return new Response(JSON.stringify({ error: "not_connected" }), { status: 400, headers: corsHeaders });

      if (action === "list") {
        const emails = await listEmails(accessToken);
        return new Response(JSON.stringify({ emails }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (action === "get") {
        const email = await getEmail(accessToken, body.id);
        return new Response(JSON.stringify({ email }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (action === "send") {
        const result = await sendReply(accessToken, body.threadId, body.toEmail, body.subject, body.text, body.messageIdHeader);
        return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (action === "propose_reply" || action === "chat") {
      const emailContext = body.emailContext;
      const history = body.history || [];
      const userMsg = action === "propose_reply" ? "Proponi una bozza di risposta a questa email." : body.message;

      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: `${EMAIL_SYSTEM_PROMPT}\n\nEMAIL RICEVUTA:\nDa: ${emailContext.from}\nOggetto: ${emailContext.subject}\n\n${emailContext.body}`,
        messages: [...history, { role: "user", content: userMsg }],
      });
      const textBlock = response.content.find((b: any) => b.type === "text") as any;
      const reply = textBlock ? textBlock.text : "";
      return new Response(JSON.stringify({ reply }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: corsHeaders });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
