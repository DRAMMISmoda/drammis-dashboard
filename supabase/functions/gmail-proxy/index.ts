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

const SUPPLIER_CATEGORIES = ["fornitori_cinte", "fornitori_fibbie", "fornitori_packaging", "fornitori_cartellini", "fornitori_generali"];
const ALL_CATEGORIES = ["clienti", ...SUPPLIER_CATEGORIES, "importanti"];

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

async function getAccessToken(userId: string): Promise<{ accessToken: string | null; email: string | null }> {
  const { data: row } = await supabaseAdmin.from("google_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!row) return { accessToken: null, email: null };

  const expiresAt = row.access_token_expires_at ? new Date(row.access_token_expires_at).getTime() : 0;
  if (row.access_token && expiresAt > Date.now() + 60000) return { accessToken: row.access_token, email: row.email };

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
    return { accessToken: null, email: row.email };
  }

  await supabaseAdmin.from("google_tokens").update({
    access_token: tokenData.access_token,
    access_token_expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);

  return { accessToken: tokenData.access_token, email: row.email };
}

function headerVal(headers: any[], name: string): string {
  const h = headers?.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
  return h?.value || "";
}

function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).toLowerCase().trim();
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

async function getContacts(): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from("email_contacts").select("email, category");
  const map: Record<string, string> = {};
  (data || []).forEach((r: any) => { map[r.email.toLowerCase()] = r.category; });
  return map;
}

async function saveContact(email: string, category: string) {
  await supabaseAdmin.from("email_contacts").upsert({ email: email.toLowerCase(), category, updated_at: new Date().toISOString() });
}

const CATEGORY_SYSTEM_PROMPT = `Analizza queste email/conversazioni arrivate nella casella di DRAMMIS, un piccolo brand italiano di cinture in pelle. Per ciascuna scegli UNA categoria tra:
- "fornitori_cinte": SOLO se è chiaro che il mittente produce/fornisce le cinture stesse al brand (pelle, conceria, taglio, cucitura)
- "fornitori_fibbie": SOLO se è chiaro che il mittente produce/fornisce fibbie e componenti metallici al brand
- "fornitori_packaging": SOLO se è chiaro che il mittente fornisce scatole, imballaggi, buste al brand
- "fornitori_cartellini": SOLO se è chiaro che il mittente fornisce cartellini, etichette, stampe al brand
- "fornitori_generali": SOLO se è chiaro un rapporto commerciale in corso in cui il mittente fornisce un servizio pagato al brand (corriere, commercialista, agenzia, hosting/software)
- "importanti": usa questa come categoria di DEFAULT ogni volta che non sei sicuro al 100% che sia un fornitore — comprende nuovi clienti, richieste di collaborazione, notifiche di servizi generici, domande, problemi, banca, questioni legali, stampa/influencer, o qualunque email ambigua
Nel dubbio scegli SEMPRE "importanti": è preferibile che Manuel debba spostarla a mano una volta, piuttosto che una email importante finisca nascosta tra i fornitori.
Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo: le chiavi sono gli id forniti, i valori sono una delle categorie sopra elencate (mai "clienti", quella è già gestita separatamente).`;

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
    const raw = (textBlock?.text || "{}").trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    console.error("classifyRemaining failed", e);
    return {};
  }
}

async function listThreads(accessToken: string, myEmail: string) {
  const query = "in:inbox -category:social -category:promotions -category:updates -category:forums";
  const list = await gmailFetch(accessToken, `/threads?maxResults=20&q=${encodeURIComponent(query)}`);
  const threadIds = (list.threads || []).map((t: any) => t.id);

  const threads = await Promise.all(
    threadIds.map((id: string) =>
      gmailFetch(accessToken, `/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)
    )
  );

  const [contacts, { data: orders }] = await Promise.all([
    getContacts(),
    supabaseAdmin.from("orders").select("email"),
  ]);
  const customerEmails = new Set((orders || []).map((o: any) => (o.email || "").toLowerCase()));
  const myEmailLower = (myEmail || "").toLowerCase();

  const toClassify: { id: string; from: string; subject: string; snippet: string }[] = [];
  const prepared = threads.map((t: any) => {
    const messages = t.messages || [];
    const first = messages[0];
    const last = messages[messages.length - 1];
    const from = headerVal(first.payload.headers, "From");
    const fromEmail = extractEmail(from);
    const lastFromEmail = extractEmail(headerVal(last.payload.headers, "From"));

    let category = contacts[fromEmail] || null;
    if (!category && customerEmails.has(fromEmail)) category = "clienti";
    const subject = headerVal(first.payload.headers, "Subject");
    if (!category) toClassify.push({ id: t.id, from, subject, snippet: t.snippet });

    return {
      id: t.id,
      from,
      fromEmail,
      subject,
      date: headerVal(last.payload.headers, "Date"),
      snippet: t.snippet,
      unread: messages.some((m: any) => (m.labelIds || []).includes("UNREAD")),
      needsReply: lastFromEmail !== myEmailLower,
      messageCount: messages.length,
      category,
    };
  });

  const aiResults = await classifyRemaining(toClassify);
  const learnPromises: Promise<any>[] = [];
  const final = prepared.map((t: any) => {
    let category = t.category;
    if (!category) {
      category = ALL_CATEGORIES.includes(aiResults[t.id]) ? aiResults[t.id] : "importanti";
    }
    if (!contacts[t.fromEmail]) learnPromises.push(saveContact(t.fromEmail, category));
    return { ...t, category };
  });
  await Promise.all(learnPromises);

  return final;
}

async function getThread(accessToken: string, threadId: string, myEmail: string) {
  const t = await gmailFetch(accessToken, `/threads/${threadId}?format=full`);
  const myEmailLower = (myEmail || "").toLowerCase();
  const messages = (t.messages || []).map((m: any) => {
    const from = headerVal(m.payload.headers, "From");
    const fromEmail = extractEmail(from);
    return {
      id: m.id,
      from,
      date: headerVal(m.payload.headers, "Date"),
      subject: headerVal(m.payload.headers, "Subject"),
      messageIdHeader: headerVal(m.payload.headers, "Message-ID"),
      body: findBodyPart(m.payload),
      isMe: fromEmail === myEmailLower,
    };
  });
  const last = messages[messages.length - 1];
  const other = messages.find((m: any) => !m.isMe) || messages[0];
  return {
    threadId: t.id,
    subject: messages[0]?.subject || "",
    otherFrom: other?.from || "",
    otherEmail: other ? extractEmail(other.from) : "",
    messages,
    lastMessageIdHeader: last?.messageIdHeader || "",
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

const EMAIL_SYSTEM_PROMPT = `Sei l'assistente personale di Manuel, il fondatore di DRAMMIS (maison italiana di cinture). Lo aiuti a gestire la posta di info.drammis@gmail.com. Rispondi sempre in italiano, tono professionale, cordiale, diretto e conciso, come scriverebbe Manuel stesso a un cliente o fornitore. Non inventare mai informazioni su ordini, prezzi o policy che non conosci: se l'email richiede dati specifici che non hai, scrivi una risposta che chiede questi dettagli oppure rimanda a info.drammis@gmail.com. Ti viene data l'intera conversazione fin qui (loro e le eventuali risposte di Manuel), usala per capire il contesto. Quando proponi una bozza di risposta, scrivi SOLO il testo del prossimo messaggio da inviare, senza commenti tuoi prima o dopo.`;

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

    if (action === "set_category") {
      await saveContact(body.email, body.category);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (["list", "get", "send"].includes(action)) {
      const { accessToken, email: myEmail } = await getAccessToken(user.id);
      if (!accessToken) return new Response(JSON.stringify({ error: "not_connected" }), { status: 400, headers: corsHeaders });

      if (action === "list") {
        const threads = await listThreads(accessToken, myEmail || "");
        return new Response(JSON.stringify({ threads }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (action === "get") {
        const thread = await getThread(accessToken, body.id, myEmail || "");
        return new Response(JSON.stringify({ thread }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (action === "send") {
        const result = await sendReply(accessToken, body.threadId, body.toEmail, body.subject, body.text, body.messageIdHeader);
        return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    if (action === "propose_reply" || action === "chat") {
      const emailContext = body.emailContext;
      const history = body.history || [];
      const userMsg = action === "propose_reply" ? "Proponi una bozza di risposta a questa conversazione." : body.message;

      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 1024,
        system: `${EMAIL_SYSTEM_PROMPT}\n\nCONVERSAZIONE CON: ${emailContext.from}\nOggetto: ${emailContext.subject}\n\n${emailContext.transcript}`,
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
