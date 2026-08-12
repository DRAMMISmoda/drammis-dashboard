(function () {
  'use strict';

  const supa = window.supabase.createClient(
    'https://lyflfedxiosvayxjttzt.supabase.co',
    'sb_publishable_QDVY9dfdfWN6hmPbcY2YiQ_u990NtPE'
  );

  const app = document.getElementById('app');
  const logoutBtn = document.getElementById('logoutBtn');
  const euro = (n) => '€' + Math.round(n || 0).toLocaleString('it-IT');
  const escapeHtml = (str) => { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; };

  /* ---------- POSTA (Gmail) ---------- */
  const GOOGLE_CLIENT_ID = '942982110982-r7bdn2uei5a0lv794p418190m7mk7i5b.apps.googleusercontent.com';
  const GMAIL_REDIRECT_URI = 'https://lyflfedxiosvayxjttzt.supabase.co/functions/v1/gmail-oauth-callback';
  const GMAIL_PROXY_URL = 'https://lyflfedxiosvayxjttzt.supabase.co/functions/v1/gmail-proxy';
  const CATEGORY_OPTIONS = [
    { value: 'clienti', label: 'Clienti' },
    { value: 'fornitori_cinte', label: 'Fornitori · Cinte' },
    { value: 'fornitori_fibbie', label: 'Fornitori · Fibbie' },
    { value: 'fornitori_packaging', label: 'Fornitori · Packaging' },
    { value: 'fornitori_cartellini', label: 'Fornitori · Cartellini' },
    { value: 'fornitori_generali', label: 'Fornitori · Generali' },
    { value: 'importanti', label: 'Importanti' },
  ];
  const SUPPLIER_SUBS = [['tutti', 'Tutti'], ['cinte', 'Cinte'], ['fibbie', 'Fibbie'], ['packaging', 'Packaging'], ['cartellini', 'Cartellini'], ['generali', 'Generali']];
  const REPLY_FILTERS = [['tutti', 'Tutti'], ['da_rispondere', 'Da rispondere'], ['risposto', 'Già risposto']];
  const BUCKET_ORDER = ['Oggi', 'Ieri', 'Questa settimana', 'Più vecchie'];

  let currentEmailCategory = 'clienti';
  let currentSupplierSub = 'tutti';
  let currentReplyFilter = 'tutti';
  let threadsCache = [];
  let currentThreadDetail = null;
  let emailChatHistory = [];
  let gmailReturnStatus = null;
  let postaConnectedEmail = null;

  async function gmailCall(action, extra) {
    let { data: { session } } = await supa.auth.getSession();
    if (!session) session = await restoreSession();
    if (!session) throw new Error('Sessione scaduta, ricarica la pagina.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let res;
    try {
      res = await fetch(GMAIL_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action, ...(extra || {}) }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    return res.json();
  }

  function dateBucket(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startYesterday = new Date(startToday.getTime() - 86400000);
    const startWeek = new Date(startToday.getTime() - 6 * 86400000);
    if (d >= startToday) return 'Oggi';
    if (d >= startYesterday) return 'Ieri';
    if (d >= startWeek) return 'Questa settimana';
    return 'Più vecchie';
  }

  function buildTranscript(thread) {
    return thread.messages.map((m) => `${m.isMe ? 'Tu' : 'Loro'} (${m.date}):\n${m.body}`).join('\n\n---\n\n');
  }

  /* ---------- SOCIAL (TikTok + Instagram) ---------- */
  const TIKTOK_CLIENT_KEY = 'sbaw9jo9nuke7ijzlt';
  const TIKTOK_REDIRECT_URI = 'https://lyflfedxiosvayxjttzt.supabase.co/functions/v1/tiktok-oauth-callback';
  const TIKTOK_PROXY_URL = 'https://lyflfedxiosvayxjttzt.supabase.co/functions/v1/tiktok-proxy';
  const INSTAGRAM_APP_ID = '1357911855965090';
  const INSTAGRAM_REDIRECT_URI = 'https://lyflfedxiosvayxjttzt.supabase.co/functions/v1/instagram-oauth-callback';
  const INSTAGRAM_PROXY_URL = 'https://lyflfedxiosvayxjttzt.supabase.co/functions/v1/instagram-proxy';
  let tiktokReturnStatus = null;
  let instagramReturnStatus = null;
  let currentSocialPlatform = 'tiktok';
  let instagramMediaCache = [];
  let instagramGrowthChart = null;
  let instagramMediaChart = null;
  let mediaDetailChart = null;

  async function apiCall(url, action, extra) {
    let { data: { session } } = await supa.auth.getSession();
    if (!session) session = await restoreSession();
    if (!session) throw new Error('Sessione scaduta, ricarica la pagina.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action, ...(extra || {}) }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    return res.json();
  }

  const tiktokCall = (action, extra) => apiCall(TIKTOK_PROXY_URL, action, extra);
  const instagramCall = (action, extra) => apiCall(INSTAGRAM_PROXY_URL, action, extra);

  function socialPlatformTabsHtml() {
    return `<div class="admin__periods" id="socialPlatformTabs">${[['tiktok', 'TikTok'], ['instagram', 'Instagram']].map(([key, label]) =>
      `<button class="pill ${key === currentSocialPlatform ? 'pill--dark' : 'pill--ghost'}" data-platform="${key}">${label}</button>`
    ).join('')}</div>`;
  }
  function wireSocialPlatformTabs() {
    document.querySelectorAll('#socialPlatformTabs [data-platform]').forEach((btn) => {
      btn.addEventListener('click', () => { currentSocialPlatform = btn.dataset.platform; renderSocialSection(); });
    });
  }

  function numFmt(n) {
    return (n || 0).toLocaleString('it-IT');
  }

  /* ---------- CODICE DI SICUREZZA (PIN a 6 cifre) ----------
     La vera sicurezza resta la sessione Supabase (email+password);
     questo PIN è solo un lucchetto rapido sopra, salvato SOLO su
     questo dispositivo (non su Supabase) — niente Face ID, niente
     dipendenze dal browser/biometria che ci hanno dato problemi. */
  const PIN_HASH_KEY = 'drammis_pin_hash';
  const PIN_UNLOCK_KEY = 'drammis_pin_unlocked'; // sessionStorage: si azzera quando chiudi la scheda/il browser

  /* ---------- SALVATAGGIO MANUALE DELLA SESSIONE ----------
     Il meccanismo automatico di Supabase (che dovrebbe salvare la sessione
     da solo) non sta funzionando in modo affidabile — nessuna richiesta di
     rete né token salvato dopo un refresh. La salviamo noi stessi con la
     stessa localStorage che già sappiamo funzionare (il PIN ci resta). */
  const SESSION_KEY = 'drammis_session';
  function saveSession(session) {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }));
    else localStorage.removeItem(SESSION_KEY);
  }
  async function restoreSession() {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const { access_token, refresh_token } = JSON.parse(raw);
      const { data, error } = await supa.auth.setSession({ access_token, refresh_token });
      if (error) { localStorage.removeItem(SESSION_KEY); return null; }
      return data.session;
    } catch (e) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  async function hashPin(pin) {
    const enc = new TextEncoder().encode('drammis-dashboard-pin::' + pin);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function pinInputHtml(id) {
    return `<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" id="${id}" style="letter-spacing:.5em;text-align:center;font-size:1.4rem">`;
  }

  function renderPinSetup() {
    logoutBtn.hidden = false;
    menuBtn.hidden = true;
    app.innerHTML = `
      <div class="login-card">
        <h1>Crea un codice</h1>
        <p class="msg">Scegli un codice a 6 cifre: da ora in poi ti basterà quello per aprire la dashboard su questo dispositivo, senza dover reinserire email e password ogni volta.</p>
        <form id="pinSetupForm" novalidate>
          <label>Codice (6 cifre)${pinInputHtml('pinNew')}</label>
          <label>Ripeti il codice${pinInputHtml('pinNewConfirm')}</label>
          <button class="pill pill--dark" type="submit">Salva codice →</button>
        </form>
        <p class="msg" id="pinSetupMsg" hidden></p>
      </div>`;

    document.getElementById('pinSetupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('pinSetupMsg');
      const a = document.getElementById('pinNew').value.trim();
      const b = document.getElementById('pinNewConfirm').value.trim();
      if (!/^\d{6}$/.test(a)) { msg.hidden = false; msg.textContent = 'Il codice deve essere di 6 cifre.'; return; }
      if (a !== b) { msg.hidden = false; msg.textContent = 'I due codici non coincidono.'; return; }
      localStorage.setItem(PIN_HASH_KEY, await hashPin(a));
      sessionStorage.setItem(PIN_UNLOCK_KEY, '1');
      renderDashboard();
    });
  }

  function renderPinLock() {
    logoutBtn.hidden = false;
    menuBtn.hidden = true;
    app.innerHTML = `
      <div class="login-card">
        <h1>Inserisci il codice</h1>
        <form id="pinLockForm" novalidate>
          <label>Codice (6 cifre)${pinInputHtml('pinEnter')}</label>
          <button class="pill pill--dark" type="submit">Sblocca →</button>
        </form>
        <a href="#" id="forgotPinLink" class="msg" style="text-decoration:underline;display:inline-block;margin-top:.4rem">Codice dimenticato?</a>
        <p class="msg" id="pinLockMsg" hidden></p>
      </div>`;

    document.getElementById('pinEnter').focus();

    document.getElementById('pinLockForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('pinLockMsg');
      const entered = document.getElementById('pinEnter').value.trim();
      const storedHash = localStorage.getItem(PIN_HASH_KEY);
      if (await hashPin(entered) === storedHash) {
        sessionStorage.setItem(PIN_UNLOCK_KEY, '1');
        renderDashboard();
      } else {
        msg.hidden = false;
        msg.textContent = 'Codice sbagliato, riprova.';
      }
    });

    document.getElementById('forgotPinLink').addEventListener('click', (e) => {
      e.preventDefault();
      localStorage.removeItem(PIN_HASH_KEY);
      sessionStorage.removeItem(PIN_UNLOCK_KEY);
      supa.auth.signOut().then(() => checkAndRender());
    });
  }

  /* ---------- LOGIN GATE (email + password) ---------- */
  function renderLoginGate(errorText) {
    logoutBtn.hidden = true;
    menuBtn.hidden = true;
    app.innerHTML = `
      <div class="login-card">
        <h1>Accedi</h1>
        <form id="loginForm" novalidate>
          <label>Email<input type="email" name="email" required autocomplete="username"></label>
          <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
          <button class="pill pill--dark" type="submit">Accedi →</button>
        </form>
        <a href="#" id="forgotLink" class="msg" style="text-decoration:underline;display:inline-block;margin-top:.4rem">Password dimenticata?</a>
        <p class="msg" id="loginMsg" ${errorText ? '' : 'hidden'}>${errorText || ''}</p>
      </div>`;

    document.getElementById('loginForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button[type="submit"]');
      const msg = document.getElementById('loginMsg');
      btn.disabled = true;
      supa.auth.signInWithPassword({ email: fd.get('email').trim().toLowerCase(), password: fd.get('password') })
        .then(({ data, error }) => {
          btn.disabled = false;
          if (error) { msg.hidden = false; msg.textContent = error.message === 'Invalid login credentials' ? 'Email o password non corrette.' : error.message; return; }
          saveSession(data.session);
          checkAndRender();
        });
    });

    document.getElementById('forgotLink').addEventListener('click', (e) => {
      e.preventDefault();
      renderForgotGate();
    });
  }

  function renderForgotGate() {
    logoutBtn.hidden = true;
    menuBtn.hidden = true;
    app.innerHTML = `
      <div class="login-card">
        <h1>Recupera password</h1>
        <p class="msg">Inserisci la tua email: ti mandiamo un link per reimpostare la password.</p>
        <form id="forgotForm" novalidate>
          <label>Email<input type="email" name="email" required autocomplete="username"></label>
          <button class="pill pill--dark" type="submit">Invia link →</button>
        </form>
        <a href="#" id="backToLogin" class="msg" style="text-decoration:underline;display:inline-block;margin-top:.4rem">Torna al login</a>
        <p class="msg" id="forgotMsg" hidden></p>
      </div>`;

    document.getElementById('backToLogin').addEventListener('click', (e) => { e.preventDefault(); renderLoginGate(); });
    document.getElementById('forgotForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button[type="submit"]');
      const msg = document.getElementById('forgotMsg');
      btn.disabled = true;
      supa.auth.resetPasswordForEmail(fd.get('email').trim().toLowerCase(), {
        redirectTo: window.location.origin + window.location.pathname,
      }).then(({ error }) => {
        btn.disabled = false;
        msg.hidden = false;
        msg.textContent = error ? error.message : 'Controlla la tua email — ti abbiamo mandato il link per reimpostare la password.';
      });
    });
  }

  function renderRecoveryGate() {
    logoutBtn.hidden = true;
    menuBtn.hidden = true;
    app.innerHTML = `
      <div class="login-card">
        <h1>Nuova password</h1>
        <p class="msg">Scegli una nuova password per il tuo account.</p>
        <form id="recoveryForm" novalidate>
          <label>Nuova password<input type="password" name="password" required minlength="6" autocomplete="new-password"></label>
          <button class="pill pill--dark" type="submit">Salva password →</button>
        </form>
        <p class="msg" id="recoveryMsg" hidden></p>
      </div>`;

    document.getElementById('recoveryForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('button[type="submit"]');
      const msg = document.getElementById('recoveryMsg');
      btn.disabled = true;
      supa.auth.updateUser({ password: fd.get('password') }).then(async ({ error }) => {
        btn.disabled = false;
        if (error) { msg.hidden = false; msg.textContent = error.message; return; }
        const { data: { session } } = await supa.auth.getSession();
        saveSession(session);
        history.replaceState(null, '', location.pathname); // rimuove type=recovery dall'URL
        checkAndRender();
      });
    });
  }

  function renderNotAdmin() {
    logoutBtn.hidden = false;
    menuBtn.hidden = true;
    app.innerHTML = `<div class="login-card"><h1>Accesso negato</h1><p class="msg">Questo account non ha i permessi per vedere questa dashboard.</p></div>`;
  }

  /* ---------- DASHBOARD (a sezioni, con menu) ---------- */
  const PERIODS = {
    day: { label: 'Oggi', days: 1 },
    week: { label: 'Settimana', days: 7 },
    month: { label: 'Mese', days: 30 },
    year: { label: 'Anno', days: 365 },
  };
  const SECTIONS = {
    riepilogo: 'Riepilogo',
    vendite: 'Vendite',
    resi: 'Resi',
    traffico: 'Traffico',
    posta: 'Posta',
    social: 'Social',
  };
  let chart = null;
  let trafficChart = null;
  let socialGrowthChart = null;
  let socialVideoChart = null;
  let videoDetailChart = null;
  let socialVideosCache = [];
  let currentSection = 'riepilogo';
  let currentPeriod = 'week';
  const menuBtn = document.getElementById('menuBtn');
  const menuOverlay = document.getElementById('menuOverlay');
  const menuDrawer = document.getElementById('menuDrawer');
  const topbarSection = document.getElementById('topbarSection');

  function openMenu() { menuOverlay.hidden = false; menuDrawer.hidden = false; }
  function closeMenu() { menuOverlay.hidden = true; menuDrawer.hidden = true; }
  menuBtn.addEventListener('click', openMenu);
  menuOverlay.addEventListener('click', closeMenu);
  document.getElementById('menuCloseBtn').addEventListener('click', closeMenu);
  menuDrawer.querySelectorAll('[data-section]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentSection = btn.dataset.section;
      closeMenu();
      checkAndRender(); // sempre dal controllo vero (sessione + PIN), mai direttamente renderDashboard()
    });
  });

  function periodPillsHtml() {
    return `<div class="admin__periods">${Object.entries(PERIODS).map(([key, p]) =>
      `<button class="pill ${key === currentPeriod ? 'pill--dark' : 'pill--ghost'}" data-period="${key}">${p.label}</button>`
    ).join('')}</div>`;
  }
  function wirePeriodPills(onChange) {
    app.querySelectorAll('[data-period]').forEach((btn) => {
      btn.addEventListener('click', () => { currentPeriod = btn.dataset.period; onChange(); });
    });
  }

  function renderDashboard() {
    logoutBtn.hidden = false;
    menuBtn.hidden = false;
    topbarSection.textContent = SECTIONS[currentSection];
    menuDrawer.querySelectorAll('[data-section]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.section === currentSection);
    });

    if (currentSection === 'resi') renderReturnsSection();
    else if (currentSection === 'traffico') renderTrafficSection();
    else if (currentSection === 'riepilogo') renderRiepilogoSection();
    else if (currentSection === 'posta') renderPostaSection();
    else if (currentSection === 'social') renderSocialSection();
    else renderSalesSection();
  }

  /* ----- Riepilogo (di oggi, tutto in un colpo d'occhio) ----- */
  function startOfTodayISO() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }

  function renderRiepilogoSection() {
    const cutoff = startOfTodayISO();
    app.innerHTML = `
      <div class="section-summary" id="riepilogoSummary"><p class="msg">Carico i dati…</p></div>
      <div class="section-detail">
        <span class="section-detail__hint">Dettaglio di oggi</span>
        <div class="admin__tables" id="riepilogoTables"></div>
      </div>`;

    Promise.all([
      supa.from('orders').select('id, email, total, created_at').gte('created_at', cutoff).order('created_at', { ascending: false }),
      supa.from('returns').select('id, status, created_at').gte('created_at', cutoff),
      supa.from('events').select('type').gte('created_at', cutoff),
    ]).then(([ordersRes, returnsRes, eventsRes]) => {
      if (ordersRes.error) throw ordersRes.error;
      if (returnsRes.error) throw returnsRes.error;
      if (eventsRes.error) throw eventsRes.error;
      const orders = ordersRes.data || [];
      const returns = returnsRes.data || [];
      const events = eventsRes.data || [];
      const revenue = orders.reduce((s, o) => s + (o.total || 0), 0);
      const visits = events.filter((e) => e.type === 'page_view').length;

      document.getElementById('riepilogoSummary').innerHTML = `
        <div class="section-summary__stat"><span class="section-summary__label">Fatturato oggi</span><span class="section-summary__value">${euro(revenue)}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Ordini oggi</span><span class="section-summary__value">${orders.length}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Resi oggi</span><span class="section-summary__value">${returns.length}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Visite oggi</span><span class="section-summary__value">${visits}</span></div>`;

      const ordersList = orders.map((o) => `
        <tr><td>${new Date(o.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</td><td>${o.email || '—'}</td><td>${euro(o.total)}</td></tr>
      `).join('') || '<tr><td colspan="3">Nessun ordine oggi</td></tr>';
      const returnsList = returns.map((r) => `
        <tr><td>${new Date(r.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</td><td>${r.status || '—'}</td></tr>
      `).join('') || '<tr><td colspan="2">Nessun reso oggi</td></tr>';

      document.getElementById('riepilogoTables').innerHTML = `
        <div class="admin__table-card"><h3>Ordini di oggi</h3><table class="admin__table"><thead><tr><th>Ora</th><th>Cliente</th><th>Totale</th></tr></thead><tbody>${ordersList}</tbody></table></div>
        <div class="admin__table-card"><h3>Resi di oggi</h3><table class="admin__table"><thead><tr><th>Ora</th><th>Stato</th></tr></thead><tbody>${returnsList}</tbody></table></div>`;
    }).catch(() => {
      const s = document.getElementById('riepilogoSummary');
      if (s) s.innerHTML = `<p class="msg">Non riesco a caricare i dati. Riprova tra poco.</p>`;
    });
  }

  /* ----- Vendite ----- */
  function renderSalesSection() {
    const cutoff = new Date(Date.now() - PERIODS[currentPeriod].days * 86400000).toISOString();
    app.innerHTML = `
      ${periodPillsHtml()}
      <div class="section-summary" id="salesSummary"><p class="msg">Carico i dati…</p></div>
      <div class="section-detail">
        <span class="section-detail__hint">Dettaglio</span>
        <div class="admin__chart-wrap"><canvas id="chart" height="90"></canvas></div>
        <div class="admin__tables" id="salesTables"></div>
      </div>`;
    wirePeriodPills(renderSalesSection);

    supa.from('orders').select('id, email, total, created_at, status, order_items(name, qty)').gte('created_at', cutoff).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) throw error;
        const orders = data || [];
        const revenue = orders.reduce((s, o) => s + (o.total || 0), 0);
        const avgOrder = orders.length ? Math.round(revenue / orders.length) : 0;

        document.getElementById('salesSummary').innerHTML = `
          <div class="section-summary__stat"><span class="section-summary__label">Fatturato</span><span class="section-summary__value">${euro(revenue)}</span></div>
          <div class="section-summary__stat"><span class="section-summary__label">Ordini</span><span class="section-summary__value">${orders.length}</span></div>
          <div class="section-summary__stat"><span class="section-summary__label">Valore medio</span><span class="section-summary__value">${euro(avgOrder)}</span></div>`;

        renderChart(orders);

        const recentOrders = orders.slice(0, 20).map((o) => `
          <tr><td>${new Date(o.created_at).toLocaleDateString('it-IT')}</td><td>${o.email || '—'}</td><td>${euro(o.total)}</td><td>${o.status || '—'}</td></tr>
        `).join('') || '<tr><td colspan="4">Nessun ordine nel periodo</td></tr>';

        const productTotals = {};
        orders.forEach((o) => (o.order_items || []).forEach((it) => { productTotals[it.name] = (productTotals[it.name] || 0) + it.qty; }));
        const topProducts = Object.entries(productTotals).sort((a, b) => b[1] - a[1]).slice(0, 8)
          .map(([name, qty]) => `<tr><td>${name}</td><td>${qty}</td></tr>`).join('') || '<tr><td colspan="2">Nessun dato nel periodo</td></tr>';

        document.getElementById('salesTables').innerHTML = `
          <div class="admin__table-card"><h3>Ordini recenti</h3><table class="admin__table"><thead><tr><th>Data</th><th>Cliente</th><th>Totale</th><th>Stato</th></tr></thead><tbody>${recentOrders}</tbody></table></div>
          <div class="admin__table-card"><h3>Prodotti più venduti</h3><table class="admin__table"><thead><tr><th>Prodotto</th><th>Unità</th></tr></thead><tbody>${topProducts}</tbody></table></div>`;
      }).catch(() => {
        const s = document.getElementById('salesSummary');
        if (s) s.innerHTML = `<p class="msg">Non riesco a caricare i dati. Riprova tra poco.</p>`;
      });
  }

  function chartDarkOptions() {
    return {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0, color: 'rgba(250,250,245,.65)' }, grid: { color: 'rgba(255,255,255,.08)' } },
        x: { ticks: { color: 'rgba(250,250,245,.65)' }, grid: { color: 'rgba(255,255,255,.08)' } },
      },
    };
  }

  function renderChart(orders) {
    const canvas = document.getElementById('chart');
    if (!canvas || !window.Chart) return;
    const byDay = {};
    orders.forEach((o) => {
      const day = new Date(o.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
      byDay[day] = (byDay[day] || 0) + 1;
    });
    if (chart) { chart.destroy(); chart = null; }
    chart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: Object.keys(byDay), datasets: [{ label: 'Ordini', data: Object.values(byDay), backgroundColor: '#FAFAF5' }] },
      options: chartDarkOptions(),
    });
  }

  /* ----- Resi ----- */
  function renderReturnsSection() {
    app.innerHTML = `
      <div class="section-summary" id="returnsSummary"><p class="msg">Carico i dati…</p></div>
      <div class="section-detail">
        <span class="section-detail__hint">Dettaglio</span>
        <div class="admin__tables" id="returnsTables"></div>
      </div>`;

    supa.from('returns').select('status').then(({ data, error }) => {
      if (error) throw error;
      const returns = data || [];
      const openReturns = returns.filter((r) => r.status === 'richiesto').length;

      document.getElementById('returnsSummary').innerHTML = `
        <div class="section-summary__stat"><span class="section-summary__label">Resi aperti</span><span class="section-summary__value">${openReturns}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Totale resi</span><span class="section-summary__value">${returns.length}</span></div>`;

      const returnStatus = {};
      returns.forEach((r) => (returnStatus[r.status] = (returnStatus[r.status] || 0) + 1));
      const returnsByStatus = Object.entries(returnStatus).map(([status, n]) => `<tr><td>${status}</td><td>${n}</td></tr>`).join('') || '<tr><td colspan="2">Nessun reso</td></tr>';

      document.getElementById('returnsTables').innerHTML = `
        <div class="admin__table-card"><h3>Resi per stato</h3><table class="admin__table"><thead><tr><th>Stato</th><th>Conteggio</th></tr></thead><tbody>${returnsByStatus}</tbody></table></div>`;
    }).catch(() => {
      const s = document.getElementById('returnsSummary');
      if (s) s.innerHTML = `<p class="msg">Non riesco a caricare i dati. Riprova tra poco.</p>`;
    });
  }

  /* ----- Traffico ----- */
  function renderTrafficSection() {
    const cutoff = new Date(Date.now() - PERIODS[currentPeriod].days * 86400000).toISOString();
    app.innerHTML = `
      ${periodPillsHtml()}
      <div class="section-summary" id="trafficSummary"><p class="msg">Carico i dati…</p></div>
      <div class="section-detail">
        <span class="section-detail__hint">Dettaglio</span>
        <div class="admin__chart-wrap"><canvas id="trafficChartCanvas" height="90"></canvas></div>
        <div class="admin__tables" id="trafficTables"></div>
      </div>`;
    wirePeriodPills(renderTrafficSection);

    supa.from('events').select('type, page, product_name, created_at').gte('created_at', cutoff).then(({ data, error }) => {
      if (error) throw error;
      const events = data || [];
      const visits = events.filter((e) => e.type === 'page_view').length;
      const productViews = events.filter((e) => e.type === 'product_view').length;

      document.getElementById('trafficSummary').innerHTML = `
        <div class="section-summary__stat"><span class="section-summary__label">Visite</span><span class="section-summary__value">${visits}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Prodotti visti</span><span class="section-summary__value">${productViews}</span></div>`;

      renderTrafficChart(events);

      const pageCounts = {};
      const productClickCounts = {};
      events.forEach((e) => {
        if (e.type === 'page_view' && e.page) pageCounts[e.page] = (pageCounts[e.page] || 0) + 1;
        if (e.type === 'product_view' && e.product_name) productClickCounts[e.product_name] = (productClickCounts[e.product_name] || 0) + 1;
      });
      const topPages = Object.entries(pageCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([page, n]) => `<tr><td>${page}</td><td>${n}</td></tr>`).join('') || '<tr><td colspan="2">Nessun dato</td></tr>';
      const topProductClicks = Object.entries(productClickCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([name, n]) => `<tr><td>${name}</td><td>${n}</td></tr>`).join('') || '<tr><td colspan="2">Nessun dato</td></tr>';

      document.getElementById('trafficTables').innerHTML = `
        <div class="admin__table-card"><h3>Pagine più viste</h3><table class="admin__table"><thead><tr><th>Pagina</th><th>Visite</th></tr></thead><tbody>${topPages}</tbody></table></div>
        <div class="admin__table-card"><h3>Prodotti più cliccati</h3><table class="admin__table"><thead><tr><th>Prodotto</th><th>Click</th></tr></thead><tbody>${topProductClicks}</tbody></table></div>`;
    }).catch(() => {
      const s = document.getElementById('trafficSummary');
      if (s) s.innerHTML = `<p class="msg">Non riesco a caricare i dati. Riprova tra poco.</p>`;
    });
  }

  function renderTrafficChart(events) {
    const canvas = document.getElementById('trafficChartCanvas');
    if (!canvas || !window.Chart) return;
    const byDay = {};
    events.filter((e) => e.type === 'page_view').forEach((e) => {
      const day = new Date(e.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
      byDay[day] = (byDay[day] || 0) + 1;
    });
    if (trafficChart) { trafficChart.destroy(); trafficChart = null; }
    trafficChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: Object.keys(byDay), datasets: [{ label: 'Visite', data: Object.values(byDay), backgroundColor: '#FAFAF5' }] },
      options: chartDarkOptions(),
    });
  }


  /* ----- Posta (Gmail) ----- */
  function renderPostaSection() {
    app.innerHTML = `<p class="msg">Verifico il collegamento con Gmail…</p>`;
    gmailCall('status').then((res) => {
      if (res.connected) renderPostaInbox(res.email);
      else renderPostaConnect();
    }).catch(() => {
      app.innerHTML = `<p class="msg">Non riesco a controllare lo stato della posta. Riprova tra poco.</p>`;
    });
  }

  function renderPostaConnect() {
    const errorMsg = gmailReturnStatus === 'error'
      ? `<p class="msg" style="color:#e08a8a">Il collegamento con Gmail non è andato a buon fine. Riprova.</p>` : '';
    gmailReturnStatus = null;
    app.innerHTML = `
      <div class="login-card" style="margin:0">
        <h1>Collega la posta</h1>
        ${errorMsg}
        <p class="msg">Collega la casella email del negozio per leggere e rispondere ai messaggi da qui, con l'aiuto dell'AI. Non viene inviato nulla senza la tua conferma.</p>
        <button class="pill pill--dark" id="connectGmailBtn">Collega Gmail →</button>
      </div>`;
    document.getElementById('connectGmailBtn').addEventListener('click', async () => {
      const { data: { session } } = await supa.auth.getSession();
      const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GMAIL_REDIRECT_URI,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
        state: session.user.id,
      });
      location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    });
  }

  function renderPostaInboxShell(connectedEmail, banner) {
    app.innerHTML = `
      ${banner || ''}
      <div class="section-summary" id="postaSummary"><p class="msg">Carico le email…</p></div>
      <div class="section-detail">
        <span class="section-detail__hint">Posta di ${escapeHtml(connectedEmail || '')}</span>
        <div class="admin__periods" id="postaTabs"></div>
        <div class="admin__periods" id="postaSubTabs" hidden></div>
        <div class="admin__periods" id="postaReplyTabs"></div>
        <div id="postaList"></div>
      </div>`;
  }

  function renderPostaInbox(connectedEmail) {
    postaConnectedEmail = connectedEmail;
    const connectedMsg = gmailReturnStatus === 'connected' ? `<p class="msg" style="color:#8ac48a">Gmail collegato con successo.</p>` : '';
    gmailReturnStatus = null;
    renderPostaInboxShell(connectedEmail, connectedMsg);

    gmailCall('list').then((res) => {
      if (res.error) { app.innerHTML = `<p class="msg">Non riesco a caricare le email. Riprova tra poco.</p>`; return; }
      threadsCache = res.threads || [];
      renderPostaControls();
      renderPostaEmailList();
    }).catch(() => {
      app.innerHTML = `<p class="msg">Non riesco a caricare le email. Riprova tra poco.</p>`;
    });
  }

  function returnToPostaList() {
    currentThreadDetail = null;
    if (threadsCache.length) {
      renderPostaInboxShell(postaConnectedEmail, '');
      renderPostaControls();
      renderPostaEmailList();
    } else {
      renderPostaSection();
    }
  }

  function renderPostaControls() {
    const counts = { clienti: 0, fornitori: 0, importanti: 0, da_rispondere: 0 };
    threadsCache.forEach((t) => {
      if (t.category === 'clienti') counts.clienti++;
      else if (t.category === 'importanti') counts.importanti++;
      else counts.fornitori++;
      if (t.needsReply) counts.da_rispondere++;
    });

    document.getElementById('postaSummary').innerHTML = `
      <div class="section-summary__stat"><span class="section-summary__label">Clienti</span><span class="section-summary__value">${counts.clienti}</span></div>
      <div class="section-summary__stat"><span class="section-summary__label">Fornitori</span><span class="section-summary__value">${counts.fornitori}</span></div>
      <div class="section-summary__stat"><span class="section-summary__label">Importanti</span><span class="section-summary__value">${counts.importanti}</span></div>
      <div class="section-summary__stat"><span class="section-summary__label">Da rispondere</span><span class="section-summary__value">${counts.da_rispondere}</span></div>`;

    document.getElementById('postaTabs').innerHTML = ['clienti', 'fornitori', 'importanti'].map((cat) =>
      `<button class="pill ${cat === currentEmailCategory ? 'pill--dark' : 'pill--ghost'}" data-cat="${cat}">${cat[0].toUpperCase() + cat.slice(1)}</button>`
    ).join('');
    document.querySelectorAll('#postaTabs [data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentEmailCategory = btn.dataset.cat;
        currentSupplierSub = 'tutti';
        renderPostaControls();
        renderPostaEmailList();
      });
    });

    const subTabsEl = document.getElementById('postaSubTabs');
    if (currentEmailCategory === 'fornitori') {
      subTabsEl.hidden = false;
      subTabsEl.innerHTML = SUPPLIER_SUBS.map(([key, label]) =>
        `<button class="pill pill--sm ${key === currentSupplierSub ? 'pill--dark' : 'pill--ghost'}" data-sub="${key}">${label}</button>`
      ).join('');
      subTabsEl.querySelectorAll('[data-sub]').forEach((btn) => {
        btn.addEventListener('click', () => { currentSupplierSub = btn.dataset.sub; renderPostaControls(); renderPostaEmailList(); });
      });
    } else {
      subTabsEl.hidden = true;
      subTabsEl.innerHTML = '';
    }

    document.getElementById('postaReplyTabs').innerHTML = REPLY_FILTERS.map(([key, label]) =>
      `<button class="pill pill--sm ${key === currentReplyFilter ? 'pill--dark' : 'pill--ghost'}" data-reply="${key}">${label}</button>`
    ).join('');
    document.querySelectorAll('#postaReplyTabs [data-reply]').forEach((btn) => {
      btn.addEventListener('click', () => { currentReplyFilter = btn.dataset.reply; renderPostaControls(); renderPostaEmailList(); });
    });
  }

  function renderPostaEmailList() {
    const listEl = document.getElementById('postaList');
    if (!listEl) return;

    let filtered = threadsCache.filter((t) => {
      if (currentEmailCategory === 'clienti') return t.category === 'clienti';
      if (currentEmailCategory === 'importanti') return t.category === 'importanti';
      if (!t.category.startsWith('fornitori_')) return false;
      if (currentSupplierSub !== 'tutti' && t.category !== 'fornitori_' + currentSupplierSub) return false;
      return true;
    });
    if (currentReplyFilter === 'da_rispondere') filtered = filtered.filter((t) => t.needsReply);
    else if (currentReplyFilter === 'risposto') filtered = filtered.filter((t) => !t.needsReply);
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    const groups = {};
    filtered.forEach((t) => {
      const b = dateBucket(t.date);
      if (!groups[b]) groups[b] = [];
      groups[b].push(t);
    });

    const html = BUCKET_ORDER.filter((b) => groups[b] && groups[b].length).map((b) => `
      <div class="email-date-group">
        <h4 class="email-date-group__label">${b}</h4>
        <div class="email-list">${groups[b].map((t) => `
          <button class="email-item${t.unread ? ' email-item--unread' : ''}" data-id="${t.id}">
            <span class="email-item__top">
              <span class="email-item__from">${escapeHtml(t.from)}</span>
              ${t.needsReply ? '<span class="email-item__badge">Da rispondere</span>' : ''}
            </span>
            <span class="email-item__subject">${escapeHtml(t.subject || '(nessun oggetto)')}${t.messageCount > 1 ? ` (${t.messageCount})` : ''}</span>
            <span class="email-item__snippet">${escapeHtml(t.snippet || '')}</span>
          </button>`).join('')}</div>
      </div>`).join('');

    listEl.innerHTML = html || `<p class="msg">Nessuna email qui.</p>`;
    listEl.querySelectorAll('[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => openThreadDetail(btn.dataset.id));
    });
  }

  function openThreadDetail(id) {
    app.innerHTML = `<p class="msg">Apro la conversazione…</p>`;
    gmailCall('get', { id }).then((res) => {
      if (res.error || !res.thread) { app.innerHTML = `<p class="msg">Non riesco ad aprire la conversazione.</p>`; return; }
      currentThreadDetail = res.thread;
      emailChatHistory = [];
      renderThreadDetailView();
    }).catch(() => { app.innerHTML = `<p class="msg">Non riesco ad aprire la conversazione.</p>`; });
  }

  function renderThreadDetailView() {
    const t = currentThreadDetail;
    const found = threadsCache.find((x) => x.id === t.threadId);
    const currentCategory = found ? found.category : 'importanti';

    app.innerHTML = `
      <button class="pill pill--ghost thread-back-btn" id="backToListBtn">← Torna alla lista</button>

      <div class="admin__table-card" style="margin-bottom:1rem">
        <h3>${escapeHtml(t.subject || '(nessun oggetto)')}</h3>
        <p class="msg">Con: ${escapeHtml(t.otherFrom)}</p>
        <label class="msg" style="display:block;margin-top:.8rem">Categoria
          <select id="categoryPicker" style="display:block;margin-top:.4rem;padding:.6rem .8rem;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg);font-family:inherit;width:100%">
            ${CATEGORY_OPTIONS.map((o) => `<option value="${o.value}" ${o.value === currentCategory ? 'selected' : ''}>${o.label}</option>`).join('')}
          </select>
        </label>
      </div>

      <div class="thread-view" id="threadMessages">
        ${t.messages.map((m) => `
          <div class="email-chat-msg ${m.isMe ? 'email-chat-msg--user' : 'email-chat-msg--ai'}" style="align-self:${m.isMe ? 'flex-end' : 'flex-start'}">
            <div class="thread-msg__meta">${escapeHtml(m.isMe ? 'Tu' : m.from)} · ${escapeHtml(m.date)}</div>
            <div class="thread-msg__body">${escapeHtml(m.body).replace(/\n/g, '<br>')}</div>
          </div>`).join('')}
      </div>

      <div class="admin__table-card" style="margin:1.4rem 0">
        <h3>Bozza di risposta (AI)</h3>
        <p class="msg" id="draftStatus">Genero una proposta…</p>
        <textarea id="draftReply" rows="8" style="width:100%;margin-top:.8rem;padding:.8rem;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--fg);font-family:inherit" placeholder="La bozza apparirà qui…"></textarea>
        <div style="display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap">
          <button class="pill pill--ghost" id="regenDraftBtn">Rigenera con AI</button>
          <button class="pill pill--dark" id="confirmSendBtn">Rivedi e invia →</button>
        </div>
      </div>

      <div class="admin__table-card">
        <h3>Parlane con l'AI</h3>
        <div id="emailChatLog" class="email-chat-log"></div>
        <form id="emailChatForm" style="display:flex;gap:.6rem;margin-top:.8rem">
          <input type="text" id="emailChatInput" placeholder="Es: rendila più breve" style="flex:1;padding:.8rem 1rem;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--fg);font-family:inherit">
          <button class="pill pill--dark" type="submit">Invia</button>
        </form>
      </div>`;

    document.getElementById('backToListBtn').addEventListener('click', () => returnToPostaList());
    document.getElementById('categoryPicker').addEventListener('change', (ev) => {
      gmailCall('set_category', { email: t.otherEmail, category: ev.target.value }).then(() => {
        const idx = threadsCache.findIndex((x) => x.id === t.threadId);
        if (idx !== -1) threadsCache[idx].category = ev.target.value;
      });
    });
    document.getElementById('regenDraftBtn').addEventListener('click', () => generateDraft());
    document.getElementById('confirmSendBtn').addEventListener('click', () => confirmAndSend());
    document.getElementById('emailChatForm').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const input = document.getElementById('emailChatInput');
      const msg = input.value.trim();
      if (!msg) return;
      input.value = '';
      sendChatMessage(msg);
    });

    generateDraft();
  }

  function generateDraft() {
    const statusEl = document.getElementById('draftStatus');
    const textarea = document.getElementById('draftReply');
    if (statusEl) { statusEl.hidden = false; statusEl.textContent = 'Genero una proposta…'; }
    const t = currentThreadDetail;
    gmailCall('propose_reply', { emailContext: { from: t.otherFrom, subject: t.subject, transcript: buildTranscript(t) } })
      .then((res) => {
        if (statusEl) statusEl.hidden = true;
        if (textarea) textarea.value = res.reply || '';
        emailChatHistory = [
          { role: 'user', content: 'Proponi una bozza di risposta a questa conversazione.' },
          { role: 'assistant', content: res.reply || '' },
        ];
      })
      .catch(() => { if (statusEl) { statusEl.hidden = false; statusEl.textContent = 'Non riesco a generare una proposta. Riprova.'; } });
  }

  function sendChatMessage(message) {
    const log = document.getElementById('emailChatLog');
    if (log) log.innerHTML += `<div class="email-chat-msg email-chat-msg--user">${escapeHtml(message)}</div>`;
    const historyBefore = emailChatHistory.slice();
    emailChatHistory.push({ role: 'user', content: message });
    const t = currentThreadDetail;

    gmailCall('chat', { emailContext: { from: t.otherFrom, subject: t.subject, transcript: buildTranscript(t) }, history: historyBefore, message })
      .then((res) => {
        emailChatHistory.push({ role: 'assistant', content: res.reply || '' });
        if (log) log.innerHTML += `<div class="email-chat-msg email-chat-msg--ai">${escapeHtml(res.reply || '')}</div>`;
        const textarea = document.getElementById('draftReply');
        if (textarea && res.reply) textarea.value = res.reply;
      });
  }

  function confirmAndSend() {
    const textarea = document.getElementById('draftReply');
    const text = textarea ? textarea.value.trim() : '';
    if (!text) { alert('Scrivi o genera prima una risposta.'); return; }
    const t = currentThreadDetail;
    if (!confirm(`Invio questa risposta a ${t.otherFrom}?\n\n${text}`)) return;

    const btn = document.getElementById('confirmSendBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Invio…'; }

    gmailCall('send', {
      threadId: t.threadId,
      toEmail: t.otherEmail,
      subject: t.subject,
      text,
      messageIdHeader: t.lastMessageIdHeader,
    }).then((res) => {
      if (res.ok) {
        alert('Email inviata.');
        currentThreadDetail = null;
        renderPostaSection();
      } else {
        alert('Errore durante l\'invio: ' + (res.error || 'sconosciuto'));
        if (btn) { btn.disabled = false; btn.textContent = 'Rivedi e invia →'; }
      }
    }).catch(() => {
      alert('Errore durante l\'invio.');
      if (btn) { btn.disabled = false; btn.textContent = 'Rivedi e invia →'; }
    });
  }

  /* ----- Social ----- */
  function renderSocialSection() {
    app.innerHTML = `${socialPlatformTabsHtml()}<p class="msg">Verifico il collegamento…</p>`;
    wireSocialPlatformTabs();
    const call = currentSocialPlatform === 'tiktok' ? tiktokCall : instagramCall;
    call('status').then((res) => {
      if (currentSocialPlatform === 'tiktok') {
        if (res.connected) renderSocialProfile(); else renderSocialConnect();
      } else {
        if (res.connected) renderInstagramProfile(); else renderInstagramConnect();
      }
    }).catch(() => {
      app.innerHTML = `${socialPlatformTabsHtml()}<p class="msg">Non riesco a controllare lo stato dei social. Riprova tra poco.</p>`;
      wireSocialPlatformTabs();
    });
  }

  function renderSocialConnect() {
    const errorMsg = tiktokReturnStatus === 'error'
      ? `<p class="msg" style="color:#e08a8a">Il collegamento con TikTok non è andato a buon fine. Riprova.</p>` : '';
    tiktokReturnStatus = null;
    app.innerHTML = `
      ${socialPlatformTabsHtml()}
      <div class="login-card" style="margin:0">
        <h1>Collega TikTok</h1>
        ${errorMsg}
        <p class="msg">Collega TikTok per vedere qui follower, video e le loro statistiche (visualizzazioni, like, commenti, condivisioni).</p>
        <button class="pill pill--dark" id="connectTiktokBtn">Collega TikTok →</button>
      </div>`;
    wireSocialPlatformTabs();
    document.getElementById('connectTiktokBtn').addEventListener('click', async () => {
      const { data: { session } } = await supa.auth.getSession();
      const params = new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        redirect_uri: TIKTOK_REDIRECT_URI,
        response_type: 'code',
        scope: 'user.info.stats,user.info.profile,video.list',
        state: session.user.id,
      });
      location.href = `https://www.tiktok.com/v2/auth/authorize/?${params}`;
    });
  }

  function renderInstagramConnect() {
    const errorMsg = instagramReturnStatus === 'error'
      ? `<p class="msg" style="color:#e08a8a">Il collegamento con Instagram non è andato a buon fine. Riprova.</p>` : '';
    instagramReturnStatus = null;
    app.innerHTML = `
      ${socialPlatformTabsHtml()}
      <div class="login-card" style="margin:0">
        <h1>Collega Instagram</h1>
        ${errorMsg}
        <p class="msg">Collega l'account Instagram Business di DRAMMIS per vedere qui follower, post e le loro statistiche.</p>
        <button class="pill pill--dark" id="connectInstagramBtn">Collega Instagram →</button>
      </div>`;
    wireSocialPlatformTabs();
    document.getElementById('connectInstagramBtn').addEventListener('click', async () => {
      const { data: { session } } = await supa.auth.getSession();
      const params = new URLSearchParams({
        client_id: INSTAGRAM_APP_ID,
        redirect_uri: INSTAGRAM_REDIRECT_URI,
        response_type: 'code',
        scope: 'instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement,business_management',
        state: session.user.id,
      });
      location.href = `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
    });
  }

  function renderSocialProfile() {
    const connectedMsg = tiktokReturnStatus === 'connected' ? `<p class="msg" style="color:#8ac48a">TikTok collegato con successo.</p>` : '';
    tiktokReturnStatus = null;
    app.innerHTML = `
      ${socialPlatformTabsHtml()}
      ${connectedMsg}
      <div class="section-summary" id="socialSummary"><p class="msg">Carico i dati…</p></div>
      <div class="section-detail">
        <span class="section-detail__hint">TikTok — quadro generale</span>
        <div class="admin__table-card" style="margin-bottom:1.4rem">
          <h3>Andamento follower</h3>
          <p class="msg" style="margin-bottom:.8rem">Si costruisce da oggi in poi — TikTok non fornisce lo storico passato.</p>
          <canvas id="socialGrowthCanvas" height="80"></canvas>
        </div>
        <div class="admin__table-card" style="margin-bottom:1.4rem">
          <h3>Visualizzazioni per video (in ordine di pubblicazione)</h3>
          <canvas id="socialVideoChartCanvas" height="90"></canvas>
        </div>
        <span class="section-detail__hint">Video — clicca per il dettaglio</span>
        <div id="socialVideos"></div>
      </div>`;
    wireSocialPlatformTabs();

    Promise.all([tiktokCall('profile'), tiktokCall('videos'), tiktokCall('snapshots')]).then(([profileRes, videosRes, snapRes]) => {
      if (profileRes.error || videosRes.error) { app.innerHTML = `<p class="msg">Non riesco a caricare i dati di TikTok. Riprova tra poco.</p>`; return; }
      const p = profileRes.profile || {};
      const videos = (videosRes.videos || []).slice().sort((a, b) => (b.create_time || 0) - (a.create_time || 0));
      socialVideosCache = videos;

      document.getElementById('socialSummary').innerHTML = `
        <div class="section-summary__stat"><span class="section-summary__label">Follower</span><span class="section-summary__value">${numFmt(p.follower_count)}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Seguiti</span><span class="section-summary__value">${numFmt(p.following_count)}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Mi piace totali</span><span class="section-summary__value">${numFmt(p.likes_count)}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Video</span><span class="section-summary__value">${numFmt(p.video_count)}</span></div>`;

      renderSocialGrowthChart(snapRes.snapshots || []);
      renderSocialVideoChart(videos);

      document.getElementById('socialVideos').innerHTML = videos.length
        ? `<div class="video-list">${videos.map((v) => `
            <button class="video-item" data-video-id="${v.id}">
              ${v.cover_image_url ? `<img class="video-item__cover" src="${v.cover_image_url}" alt="">` : ''}
              <div class="video-item__body">
                <span class="video-item__title">${escapeHtml(v.title || '(senza titolo)')}</span>
                <div class="video-item__stats">
                  <span>👁 ${numFmt(v.view_count)}</span>
                  <span>❤ ${numFmt(v.like_count)}</span>
                  <span>💬 ${numFmt(v.comment_count)}</span>
                  <span>↗ ${numFmt(v.share_count)}</span>
                </div>
              </div>
            </button>`).join('')}</div>`
        : `<p class="msg">Nessun video trovato.</p>`;
      document.querySelectorAll('#socialVideos [data-video-id]').forEach((btn) => {
        btn.addEventListener('click', () => openVideoDetail(btn.dataset.videoId));
      });
    }).catch(() => {
      app.innerHTML = `<p class="msg">Non riesco a caricare i dati di TikTok. Riprova tra poco.</p>`;
    });
  }

  function renderSocialGrowthChart(snapshots) {
    const canvas = document.getElementById('socialGrowthCanvas');
    if (!canvas || !window.Chart) return;
    const sorted = snapshots.slice().sort((a, b) => new Date(a.snapshot_date) - new Date(b.snapshot_date));
    const labels = sorted.map((s) => new Date(s.snapshot_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }));
    const data = sorted.map((s) => s.follower_count);
    if (socialGrowthChart) { socialGrowthChart.destroy(); socialGrowthChart = null; }
    socialGrowthChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [{ label: 'Follower', data, borderColor: '#FAFAF5', backgroundColor: 'rgba(250,250,245,.15)', fill: true, tension: .3 }] },
      options: chartDarkOptions(),
    });
  }

  function renderSocialVideoChart(videos) {
    const canvas = document.getElementById('socialVideoChartCanvas');
    if (!canvas || !window.Chart) return;
    const sorted = videos.slice().sort((a, b) => (a.create_time || 0) - (b.create_time || 0));
    const labels = sorted.map((v) => v.create_time ? new Date(v.create_time * 1000).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) : '?');
    const data = sorted.map((v) => v.view_count || 0);
    if (socialVideoChart) { socialVideoChart.destroy(); socialVideoChart = null; }
    socialVideoChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Visualizzazioni', data, backgroundColor: '#FAFAF5' }] },
      options: chartDarkOptions(),
    });
  }

  function openVideoDetail(id) {
    const v = socialVideosCache.find((x) => x.id === id);
    if (!v) return;
    renderVideoDetailView(v);
  }

  function renderVideoDetailView(v) {
    const totalEngagement = (v.like_count || 0) + (v.comment_count || 0) + (v.share_count || 0);
    const engagementRate = v.view_count ? ((totalEngagement / v.view_count) * 100).toFixed(1) : '0.0';
    app.innerHTML = `
      <button class="pill pill--ghost thread-back-btn" id="backToSocialBtn">← Torna a Social</button>
      <div class="admin__table-card" style="margin-bottom:1.4rem">
        ${v.cover_image_url ? `<img src="${v.cover_image_url}" style="width:100%;max-width:260px;border-radius:12px;display:block;margin:0 auto 1rem">` : ''}
        <h3>${escapeHtml(v.title || '(senza titolo)')}</h3>
        <p class="msg">Pubblicato: ${v.create_time ? new Date(v.create_time * 1000).toLocaleDateString('it-IT') : '—'}</p>
        ${v.share_url ? `<a class="pill pill--ghost" href="${v.share_url}" target="_blank" rel="noopener" style="display:inline-block;margin-top:.8rem;text-decoration:none">Apri su TikTok →</a>` : ''}
      </div>
      <div class="section-summary" style="margin-bottom:1.4rem">
        <div class="section-summary__stat"><span class="section-summary__label">Visualizzazioni</span><span class="section-summary__value">${numFmt(v.view_count)}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Mi piace</span><span class="section-summary__value">${numFmt(v.like_count)}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Commenti</span><span class="section-summary__value">${numFmt(v.comment_count)}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Condivisioni</span><span class="section-summary__value">${numFmt(v.share_count)}</span></div>
      </div>
      <div class="admin__table-card">
        <h3>Confronto interazioni</h3>
        <p class="msg" style="margin-bottom:.8rem">Tasso di interazione: <strong>${engagementRate}%</strong> (mi piace + commenti + condivisioni rispetto alle visualizzazioni)</p>
        <canvas id="videoDetailChartCanvas" height="90"></canvas>
      </div>`;

    document.getElementById('backToSocialBtn').addEventListener('click', () => renderSocialProfile());

    const canvas = document.getElementById('videoDetailChartCanvas');
    if (canvas && window.Chart) {
      if (videoDetailChart) { videoDetailChart.destroy(); videoDetailChart = null; }
      videoDetailChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels: ['Mi piace', 'Commenti', 'Condivisioni'], datasets: [{ data: [v.like_count || 0, v.comment_count || 0, v.share_count || 0], backgroundColor: '#FAFAF5' }] },
        options: chartDarkOptions(),
      });
    }
  }

  function renderInstagramProfile() {
    const connectedMsg = instagramReturnStatus === 'connected' ? `<p class="msg" style="color:#8ac48a">Instagram collegato con successo.</p>` : '';
    instagramReturnStatus = null;
    app.innerHTML = `
      ${socialPlatformTabsHtml()}
      ${connectedMsg}
      <div class="section-summary" id="socialSummary"><p class="msg">Carico i dati…</p></div>
      <div class="section-detail">
        <span class="section-detail__hint">Instagram — quadro generale</span>
        <div class="admin__table-card" style="margin-bottom:1.4rem">
          <h3>Andamento follower</h3>
          <p class="msg" style="margin-bottom:.8rem">Si costruisce da oggi in poi — Instagram non fornisce lo storico passato.</p>
          <canvas id="instagramGrowthCanvas" height="80"></canvas>
        </div>
        <div class="admin__table-card" style="margin-bottom:1.4rem">
          <h3>Mi piace per post (in ordine di pubblicazione)</h3>
          <canvas id="instagramMediaChartCanvas" height="90"></canvas>
        </div>
        <span class="section-detail__hint">Post — clicca per il dettaglio</span>
        <div id="instagramMedia"></div>
      </div>`;
    wireSocialPlatformTabs();

    Promise.all([instagramCall('profile'), instagramCall('media'), instagramCall('snapshots')]).then(([profileRes, mediaRes, snapRes]) => {
      if (profileRes.error || mediaRes.error) { app.innerHTML = `<p class="msg">Non riesco a caricare i dati di Instagram. Riprova tra poco.</p>`; return; }
      const p = profileRes.profile || {};
      const media = (mediaRes.media || []).slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      instagramMediaCache = media;

      document.getElementById('socialSummary').innerHTML = `
        <div class="section-summary__stat"><span class="section-summary__label">Follower</span><span class="section-summary__value">${numFmt(p.followers_count)}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Seguiti</span><span class="section-summary__value">${numFmt(p.follows_count)}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Post</span><span class="section-summary__value">${numFmt(p.media_count)}</span></div>`;

      renderInstagramGrowthChart(snapRes.snapshots || []);
      renderInstagramMediaChart(media);

      document.getElementById('instagramMedia').innerHTML = media.length
        ? `<div class="video-list">${media.map((m) => `
            <button class="video-item" data-media-id="${m.id}">
              ${(m.thumbnail_url || m.media_url) ? `<img class="video-item__cover" src="${m.thumbnail_url || m.media_url}" alt="">` : ''}
              <div class="video-item__body">
                <span class="video-item__title">${escapeHtml((m.caption || '(senza didascalia)').slice(0, 80))}</span>
                <div class="video-item__stats">
                  <span>❤ ${numFmt(m.like_count)}</span>
                  <span>💬 ${numFmt(m.comments_count)}</span>
                  ${m.reach != null ? `<span>👁 ${numFmt(m.reach)}</span>` : ''}
                </div>
              </div>
            </button>`).join('')}</div>`
        : `<p class="msg">Nessun post trovato.</p>`;
      document.querySelectorAll('#instagramMedia [data-media-id]').forEach((btn) => {
        btn.addEventListener('click', () => openMediaDetail(btn.dataset.mediaId));
      });
    }).catch(() => {
      app.innerHTML = `<p class="msg">Non riesco a caricare i dati di Instagram. Riprova tra poco.</p>`;
    });
  }

  function renderInstagramGrowthChart(snapshots) {
    const canvas = document.getElementById('instagramGrowthCanvas');
    if (!canvas || !window.Chart) return;
    const sorted = snapshots.slice().sort((a, b) => new Date(a.snapshot_date) - new Date(b.snapshot_date));
    const labels = sorted.map((s) => new Date(s.snapshot_date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }));
    const data = sorted.map((s) => s.follower_count);
    if (instagramGrowthChart) { instagramGrowthChart.destroy(); instagramGrowthChart = null; }
    instagramGrowthChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets: [{ label: 'Follower', data, borderColor: '#FAFAF5', backgroundColor: 'rgba(250,250,245,.15)', fill: true, tension: .3 }] },
      options: chartDarkOptions(),
    });
  }

  function renderInstagramMediaChart(media) {
    const canvas = document.getElementById('instagramMediaChartCanvas');
    if (!canvas || !window.Chart) return;
    const sorted = media.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const labels = sorted.map((m) => m.timestamp ? new Date(m.timestamp).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' }) : '?');
    const data = sorted.map((m) => m.like_count || 0);
    if (instagramMediaChart) { instagramMediaChart.destroy(); instagramMediaChart = null; }
    instagramMediaChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Mi piace', data, backgroundColor: '#FAFAF5' }] },
      options: chartDarkOptions(),
    });
  }

  function openMediaDetail(id) {
    const m = instagramMediaCache.find((x) => x.id === id);
    if (!m) return;
    renderMediaDetailView(m);
  }

  function renderMediaDetailView(m) {
    app.innerHTML = `
      <button class="pill pill--ghost thread-back-btn" id="backToSocialBtn">← Torna a Social</button>
      <div class="admin__table-card" style="margin-bottom:1.4rem">
        ${(m.thumbnail_url || m.media_url) ? `<img src="${m.thumbnail_url || m.media_url}" style="width:100%;max-width:260px;border-radius:12px;display:block;margin:0 auto 1rem">` : ''}
        <h3>${escapeHtml(m.caption || '(senza didascalia)')}</h3>
        <p class="msg">Pubblicato: ${m.timestamp ? new Date(m.timestamp).toLocaleDateString('it-IT') : '—'}</p>
        ${m.permalink ? `<a class="pill pill--ghost" href="${m.permalink}" target="_blank" rel="noopener" style="display:inline-block;margin-top:.8rem;text-decoration:none">Apri su Instagram →</a>` : ''}
      </div>
      <div class="section-summary" style="margin-bottom:1.4rem">
        <div class="section-summary__stat"><span class="section-summary__label">Mi piace</span><span class="section-summary__value">${numFmt(m.like_count)}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Commenti</span><span class="section-summary__value">${numFmt(m.comments_count)}</span></div>
        ${m.reach != null ? `<div class="section-summary__stat"><span class="section-summary__label">Copertura</span><span class="section-summary__value">${numFmt(m.reach)}</span></div>` : ''}
      </div>
      <div class="admin__table-card">
        <h3>Confronto interazioni</h3>
        <canvas id="mediaDetailChartCanvas" height="90"></canvas>
      </div>`;

    document.getElementById('backToSocialBtn').addEventListener('click', () => renderInstagramProfile());

    const canvas = document.getElementById('mediaDetailChartCanvas');
    if (canvas && window.Chart) {
      if (mediaDetailChart) { mediaDetailChart.destroy(); mediaDetailChart = null; }
      mediaDetailChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels: ['Mi piace', 'Commenti'], datasets: [{ data: [m.like_count || 0, m.comments_count || 0], backgroundColor: '#FAFAF5' }] },
        options: chartDarkOptions(),
      });
    }
  }

  /* ---------- AUTH FLOW ---------- */
  function isRecoveryLink() {
    return location.hash.includes('type=recovery') || location.search.includes('type=recovery');
  }

  async function checkAndRender() {
    if (isRecoveryLink()) { renderRecoveryGate(); return; }
    let { data: { session } } = await supa.auth.getSession();
    if (!session) session = await restoreSession();
    if (!session) { renderLoginGate(); return; }
    const { data } = await supa.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle();
    if (!data) { renderNotAdmin(); return; }

    const pinHash = localStorage.getItem(PIN_HASH_KEY);
    if (!pinHash) { renderPinSetup(); return; }
    if (sessionStorage.getItem(PIN_UNLOCK_KEY) !== '1') { renderPinLock(); return; }

    const params = new URLSearchParams(location.search);
    const gmailParam = params.get('gmail');
    const tiktokParam = params.get('tiktok');
    const instagramParam = params.get('instagram');
    if (gmailParam) {
      gmailReturnStatus = gmailParam;
      currentSection = 'posta';
      history.replaceState(null, '', location.pathname);
    } else if (tiktokParam) {
      tiktokReturnStatus = tiktokParam;
      currentSection = 'social';
      currentSocialPlatform = 'tiktok';
      history.replaceState(null, '', location.pathname);
    } else if (instagramParam) {
      instagramReturnStatus = instagramParam;
      currentSection = 'social';
      currentSocialPlatform = 'instagram';
      history.replaceState(null, '', location.pathname);
    }
    renderDashboard();
  }

  supa.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { renderRecoveryGate(); return; }
    if (event === 'TOKEN_REFRESHED' && session) saveSession(session);
    if (event === 'SIGNED_OUT') saveSession(null);
  });
  // "Esci" ora blocca soltanto (torna alla schermata del codice) — non fa
  // il logout vero, così email e password non si vedono più dopo la prima
  // volta su questo dispositivo. La sessione e il codice restano salvati.
  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem(PIN_UNLOCK_KEY);
    checkAndRender();
  });

  checkAndRender();
})();
