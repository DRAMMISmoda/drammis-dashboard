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
  let currentEmailCategory = 'clienti';
  let emailsCache = [];
  let currentEmailDetail = null;
  let emailChatHistory = [];
  let gmailReturnStatus = null;

  async function gmailCall(action, extra) {
    const { data: { session } } = await supa.auth.getSession();
    const res = await fetch(GMAIL_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action, ...(extra || {}) }),
    });
    return res.json();
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
  };
  let chart = null;
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
      data: { labels: Object.keys(byDay), datasets: [{ label: 'Ordini', data: Object.values(byDay), backgroundColor: '#141414' }] },
      options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
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
        <div class="admin__tables" id="trafficTables"></div>
      </div>`;
    wirePeriodPills(renderTrafficSection);

    supa.from('events').select('type, page, product_name').gte('created_at', cutoff).then(({ data, error }) => {
      if (error) throw error;
      const events = data || [];
      const visits = events.filter((e) => e.type === 'page_view').length;
      const productViews = events.filter((e) => e.type === 'product_view').length;

      document.getElementById('trafficSummary').innerHTML = `
        <div class="section-summary__stat"><span class="section-summary__label">Visite</span><span class="section-summary__value">${visits}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Prodotti visti</span><span class="section-summary__value">${productViews}</span></div>`;

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

  function renderPostaInbox(connectedEmail) {
    const connectedMsg = gmailReturnStatus === 'connected' ? `<p class="msg" style="color:#8ac48a">Gmail collegato con successo.</p>` : '';
    gmailReturnStatus = null;
    app.innerHTML = `
      ${connectedMsg}
      <div class="section-summary" id="postaSummary"><p class="msg">Carico le email…</p></div>
      <div class="section-detail">
        <span class="section-detail__hint">Posta di ${escapeHtml(connectedEmail || '')}</span>
        <div class="admin__periods" id="postaTabs"></div>
        <div id="postaList"></div>
        <div id="supplierManager" style="margin-top:2rem"></div>
      </div>`;

    gmailCall('list').then((res) => {
      if (res.error) { app.innerHTML = `<p class="msg">Non riesco a caricare le email. Riprova tra poco.</p>`; return; }
      emailsCache = res.emails || [];
      const counts = { clienti: 0, fornitori: 0, importanti: 0 };
      emailsCache.forEach((e) => { counts[e.category] = (counts[e.category] || 0) + 1; });

      document.getElementById('postaSummary').innerHTML = `
        <div class="section-summary__stat"><span class="section-summary__label">Clienti</span><span class="section-summary__value">${counts.clienti}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Fornitori</span><span class="section-summary__value">${counts.fornitori}</span></div>
        <div class="section-summary__stat"><span class="section-summary__label">Importanti</span><span class="section-summary__value">${counts.importanti}</span></div>`;

      document.getElementById('postaTabs').innerHTML = ['clienti', 'fornitori', 'importanti'].map((cat) =>
        `<button class="pill ${cat === currentEmailCategory ? 'pill--dark' : 'pill--ghost'}" data-cat="${cat}">${cat[0].toUpperCase() + cat.slice(1)} (${counts[cat] || 0})</button>`
      ).join('');
      document.querySelectorAll('#postaTabs [data-cat]').forEach((btn) => {
        btn.addEventListener('click', () => { currentEmailCategory = btn.dataset.cat; renderPostaEmailList(); });
      });

      renderPostaEmailList();
      renderSupplierManager(document.getElementById('supplierManager'));
    }).catch(() => {
      app.innerHTML = `<p class="msg">Non riesco a caricare le email. Riprova tra poco.</p>`;
    });
  }

  function renderPostaEmailList() {
    const listEl = document.getElementById('postaList');
    if (!listEl) return;
    document.querySelectorAll('#postaTabs [data-cat]').forEach((btn) => {
      btn.classList.toggle('pill--dark', btn.dataset.cat === currentEmailCategory);
      btn.classList.toggle('pill--ghost', btn.dataset.cat !== currentEmailCategory);
    });
    const filtered = emailsCache.filter((e) => e.category === currentEmailCategory);
    listEl.innerHTML = filtered.length
      ? `<div class="email-list">${filtered.map((e) => `
          <button class="email-item${e.unread ? ' email-item--unread' : ''}" data-id="${e.id}">
            <span class="email-item__from">${escapeHtml(e.from)}</span>
            <span class="email-item__subject">${escapeHtml(e.subject || '(nessun oggetto)')}</span>
            <span class="email-item__snippet">${escapeHtml(e.snippet || '')}</span>
          </button>`).join('')}</div>`
      : `<p class="msg">Nessuna email in questa categoria.</p>`;
    listEl.querySelectorAll('[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => openEmailDetail(btn.dataset.id));
    });
  }

  function openEmailDetail(id) {
    app.innerHTML = `<p class="msg">Apro l'email…</p>`;
    gmailCall('get', { id }).then((res) => {
      if (res.error || !res.email) { app.innerHTML = `<p class="msg">Non riesco ad aprire l'email.</p>`; return; }
      currentEmailDetail = res.email;
      emailChatHistory = [];
      renderEmailDetailView();
    }).catch(() => { app.innerHTML = `<p class="msg">Non riesco ad aprire l'email.</p>`; });
  }

  function renderEmailDetailView() {
    const e = currentEmailDetail;
    app.innerHTML = `
      <button class="pill pill--ghost" id="backToListBtn" style="margin-bottom:1rem">← Torna alla lista</button>
      <div class="admin__table-card" style="margin-bottom:1.4rem">
        <h3>${escapeHtml(e.subject || '(nessun oggetto)')}</h3>
        <p class="msg">Da: ${escapeHtml(e.from)}<br>${escapeHtml(e.date)}</p>
        <div class="email-body">${escapeHtml(e.body).replace(/\n/g, '<br>')}</div>
      </div>

      <div class="admin__table-card" style="margin-bottom:1.4rem">
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

    document.getElementById('backToListBtn').addEventListener('click', () => { currentEmailDetail = null; renderPostaSection(); });
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
    gmailCall('propose_reply', { emailContext: { from: currentEmailDetail.from, subject: currentEmailDetail.subject, body: currentEmailDetail.body } })
      .then((res) => {
        if (statusEl) statusEl.hidden = true;
        if (textarea) textarea.value = res.reply || '';
        emailChatHistory = [
          { role: 'user', content: 'Proponi una bozza di risposta a questa email.' },
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

    gmailCall('chat', { emailContext: { from: currentEmailDetail.from, subject: currentEmailDetail.subject, body: currentEmailDetail.body }, history: historyBefore, message })
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
    if (!confirm(`Invio questa risposta a ${currentEmailDetail.from}?\n\n${text}`)) return;

    const btn = document.getElementById('confirmSendBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Invio…'; }

    const fromMatch = currentEmailDetail.from.match(/<([^>]+)>/);
    const toEmail = fromMatch ? fromMatch[1] : currentEmailDetail.from;

    gmailCall('send', {
      threadId: currentEmailDetail.threadId,
      toEmail,
      subject: currentEmailDetail.subject,
      text,
      messageIdHeader: currentEmailDetail.messageIdHeader,
    }).then((res) => {
      if (res.ok) {
        alert('Email inviata.');
        currentEmailDetail = null;
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

  function renderSupplierManager(container) {
    if (!container) return;
    container.innerHTML = `<p class="msg">Carico fornitori…</p>`;
    supa.from('known_suppliers').select('id, email, name').order('created_at', { ascending: false }).then(({ data }) => {
      const suppliers = data || [];
      container.innerHTML = `
        <div class="admin__table-card">
          <h3>Fornitori riconosciuti</h3>
          <p class="msg">Le email di questi indirizzi finiscono nella categoria "Fornitori" invece che "Importanti".</p>
          <div id="supplierList">${suppliers.map((s) => `<div class="supplier-row"><span>${escapeHtml(s.email)}</span><button class="pill pill--ghost" data-remove="${s.id}">Rimuovi</button></div>`).join('') || '<p class="msg">Nessun fornitore aggiunto.</p>'}</div>
          <form id="addSupplierForm" style="display:flex;gap:.6rem;margin-top:1rem">
            <input type="email" id="newSupplierEmail" placeholder="email@fornitore.com" required style="flex:1;padding:.7rem 1rem;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--fg);font-family:inherit">
            <button class="pill pill--dark" type="submit">Aggiungi</button>
          </form>
        </div>`;
      container.querySelectorAll('[data-remove]').forEach((btn) => {
        btn.addEventListener('click', () => {
          supa.from('known_suppliers').delete().eq('id', btn.dataset.remove).then(() => renderSupplierManager(container));
        });
      });
      document.getElementById('addSupplierForm').addEventListener('submit', (ev) => {
        ev.preventDefault();
        const input = document.getElementById('newSupplierEmail');
        const email = input.value.trim().toLowerCase();
        if (!email) return;
        supa.from('known_suppliers').insert({ email }).then(() => renderSupplierManager(container));
      });
    });
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

    const gmailParam = new URLSearchParams(location.search).get('gmail');
    if (gmailParam) {
      gmailReturnStatus = gmailParam;
      currentSection = 'posta';
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
