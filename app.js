(function () {
  'use strict';

  const supa = window.supabase.createClient(
    'https://lyflfedxiosvayxjttzt.supabase.co',
    'sb_publishable_QDVY9dfdfWN6hmPbcY2YiQ_u990NtPE'
  );

  const app = document.getElementById('app');
  const logoutBtn = document.getElementById('logoutBtn');
  const euro = (n) => '€' + Math.round(n || 0).toLocaleString('it-IT');

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
      renderDashboard('week');
    });
  }

  function renderPinLock() {
    logoutBtn.hidden = false;
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
        renderDashboard('week');
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
    app.innerHTML = `<div class="login-card"><h1>Accesso negato</h1><p class="msg">Questo account non ha i permessi per vedere questa dashboard.</p></div>`;
  }

  /* ---------- DASHBOARD ---------- */
  const PERIODS = {
    day: { label: 'Oggi', days: 1 },
    week: { label: 'Settimana', days: 7 },
    month: { label: 'Mese', days: 30 },
    year: { label: 'Anno', days: 365 },
  };
  let chart = null;

  function renderDashboard(period) {
    period = period || 'week';
    logoutBtn.hidden = false;
    const cutoff = new Date(Date.now() - PERIODS[period].days * 86400000).toISOString();

    app.innerHTML = `
      <div class="admin__periods">
        ${Object.entries(PERIODS).map(([key, p]) =>
          `<button class="pill ${key === period ? 'pill--dark' : 'pill--ghost'}" data-period="${key}">${p.label}</button>`
        ).join('')}
        <button class="pill pill--ghost" id="changePinBtn">Cambia codice →</button>
      </div>
      <div class="admin__tiles" id="tiles"><p class="msg">Carico i dati…</p></div>
      <div class="admin__chart-wrap"><canvas id="chart" height="90"></canvas></div>
      <div class="admin__tables" id="tables"></div>`;

    app.querySelectorAll('[data-period]').forEach((btn) => {
      btn.addEventListener('click', () => renderDashboard(btn.dataset.period));
    });
    document.getElementById('changePinBtn').addEventListener('click', () => renderPinSetup());

    Promise.all([
      supa.from('orders').select('id, email, total, created_at, status, order_items(name, qty)').gte('created_at', cutoff).order('created_at', { ascending: false }),
      supa.from('returns').select('status'),
      supa.from('events').select('type, page, product_name').gte('created_at', cutoff),
    ]).then(([ordersRes, returnsRes, eventsRes]) => {
      if (ordersRes.error || returnsRes.error || eventsRes.error) throw new Error('data error');
      const orders = ordersRes.data || [];
      const returns = returnsRes.data || [];
      const events = eventsRes.data || [];
      renderTiles(orders, returns, events);
      renderChart(orders);
      renderTables(orders, returns, events);
    }).catch(() => {
      const t = document.getElementById('tiles');
      if (t) t.innerHTML = `<p class="msg">Non riesco a caricare i dati. Riprova tra poco.</p>`;
    });
  }

  function renderTiles(orders, returns, events) {
    const el = document.getElementById('tiles');
    if (!el) return;
    const revenue = orders.reduce((s, o) => s + (o.total || 0), 0);
    const avgOrder = orders.length ? Math.round(revenue / orders.length) : 0;
    const openReturns = returns.filter((r) => r.status === 'richiesto').length;
    const visits = events.filter((e) => e.type === 'page_view').length;
    const productViews = events.filter((e) => e.type === 'product_view').length;
    const tiles = [
      ['Fatturato', euro(revenue)],
      ['Ordini', orders.length],
      ['Valore medio ordine', euro(avgOrder)],
      ['Resi aperti', openReturns],
      ['Visite', visits],
      ['Prodotti visti', productViews],
    ];
    el.innerHTML = tiles.map(([label, value]) => `
      <div class="admin__tile"><span class="admin__tile-label">${label}</span><span class="admin__tile-value">${value}</span></div>
    `).join('');
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

  function renderTables(orders, returns, events) {
    const el = document.getElementById('tables');
    if (!el) return;

    const recentOrders = orders.slice(0, 20).map((o) => `
      <tr><td>${new Date(o.created_at).toLocaleDateString('it-IT')}</td><td>${o.email || '—'}</td><td>${euro(o.total)}</td><td>${o.status || '—'}</td></tr>
    `).join('') || '<tr><td colspan="4">Nessun ordine nel periodo</td></tr>';

    const productTotals = {};
    orders.forEach((o) => (o.order_items || []).forEach((it) => { productTotals[it.name] = (productTotals[it.name] || 0) + it.qty; }));
    const topProducts = Object.entries(productTotals).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([name, qty]) => `<tr><td>${name}</td><td>${qty}</td></tr>`).join('') || '<tr><td colspan="2">Nessun dato nel periodo</td></tr>';

    const returnStatus = {};
    returns.forEach((r) => (returnStatus[r.status] = (returnStatus[r.status] || 0) + 1));
    const returnsByStatus = Object.entries(returnStatus).map(([status, n]) => `<tr><td>${status}</td><td>${n}</td></tr>`).join('') || '<tr><td colspan="2">Nessun reso</td></tr>';

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

    el.innerHTML = `
      <div class="admin__table-card"><h3>Ordini recenti</h3><table class="admin__table"><thead><tr><th>Data</th><th>Cliente</th><th>Totale</th><th>Stato</th></tr></thead><tbody>${recentOrders}</tbody></table></div>
      <div class="admin__table-card"><h3>Prodotti più venduti</h3><table class="admin__table"><thead><tr><th>Prodotto</th><th>Unità</th></tr></thead><tbody>${topProducts}</tbody></table></div>
      <div class="admin__table-card"><h3>Resi per stato</h3><table class="admin__table"><thead><tr><th>Stato</th><th>Conteggio</th></tr></thead><tbody>${returnsByStatus}</tbody></table></div>
      <div class="admin__table-card"><h3>Pagine più viste</h3><table class="admin__table"><thead><tr><th>Pagina</th><th>Visite</th></tr></thead><tbody>${topPages}</tbody></table></div>
      <div class="admin__table-card"><h3>Prodotti più cliccati</h3><table class="admin__table"><thead><tr><th>Prodotto</th><th>Click</th></tr></thead><tbody>${topProductClicks}</tbody></table></div>`;
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
    renderDashboard('week');
  }

  supa.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { renderRecoveryGate(); return; }
    if (event === 'TOKEN_REFRESHED' && session) saveSession(session);
    if (event === 'SIGNED_OUT') saveSession(null);
  });
  logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem(PIN_UNLOCK_KEY);
    saveSession(null);
    supa.auth.signOut().then(() => checkAndRender());
  });

  checkAndRender();
})();
