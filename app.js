(function () {
  'use strict';

  const supa = window.supabase.createClient(
    'https://lyflfedxiosvayxjttzt.supabase.co',
    'sb_publishable_QDVY9dfdfWN6hmPbcY2YiQ_u990NtPE'
  );

  const app = document.getElementById('app');
  const logoutBtn = document.getElementById('logoutBtn');
  const euro = (n) => '€' + Math.round(n || 0).toLocaleString('it-IT');

  /* ---------- FACE ID / TOUCH ID (WebAuthn) ---------- */
  function passkeySupported() {
    return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials;
  }
  function bufToB64url(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToBuf(b64url) {
    const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
    const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function preparePublicKeyCreationOptions(options) {
    return Object.assign({}, options, {
      challenge: b64urlToBuf(options.challenge),
      user: Object.assign({}, options.user, { id: b64urlToBuf(options.user.id) }),
      excludeCredentials: (options.excludeCredentials || []).map((c) => Object.assign({}, c, { id: b64urlToBuf(c.id) })),
    });
  }
  function preparePublicKeyRequestOptions(options) {
    return Object.assign({}, options, {
      challenge: b64urlToBuf(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((c) => Object.assign({}, c, { id: b64urlToBuf(c.id) })),
    });
  }
  function credentialCreateToJSON(cred) {
    return {
      id: cred.id,
      rawId: bufToB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: bufToB64url(cred.response.clientDataJSON),
        attestationObject: bufToB64url(cred.response.attestationObject),
      },
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    };
  }
  function credentialGetToJSON(cred) {
    return {
      id: cred.id,
      rawId: bufToB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: bufToB64url(cred.response.clientDataJSON),
        authenticatorData: bufToB64url(cred.response.authenticatorData),
        signature: bufToB64url(cred.response.signature),
        userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : undefined,
      },
      clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    };
  }

  async function setupPasskey(msgEl) {
    const show = (t) => { if (msgEl) { msgEl.hidden = false; msgEl.textContent = t; } };
    try {
      show('Preparazione…');
      const optRes = await supa.functions.invoke('webauthn-register', { body: { action: 'options' } });
      if (optRes.error || !optRes.data) throw optRes.error || new Error('no options');
      const publicKey = preparePublicKeyCreationOptions(optRes.data);
      const cred = await navigator.credentials.create({ publicKey });
      if (!cred) throw new Error('cancelled');
      const verifyRes = await supa.functions.invoke('webauthn-register', {
        body: { action: 'verify', credential: credentialCreateToJSON(cred) },
      });
      if (verifyRes.error || !verifyRes.data || !verifyRes.data.verified) throw new Error('verifica fallita');
      show('Face ID/Touch ID attivato — la prossima volta potrai accedere senza password.');
    } catch (e) {
      show('Non è stato possibile attivare Face ID su questo dispositivo. Riprova o continua con la password.');
    }
  }

  async function loginWithPasskey(email, msgEl) {
    const show = (t) => { if (msgEl) { msgEl.hidden = false; msgEl.textContent = t; } };
    if (!email) { show('Scrivi prima la tua email qui sopra.'); return; }
    try {
      show('Verifica in corso…');
      const optRes = await supa.functions.invoke('webauthn-auth', { body: { action: 'options', email } });
      if (optRes.error || !optRes.data || optRes.data.error) { show('Nessun accesso rapido configurato per questa email — usa la password.'); return; }
      const publicKey = preparePublicKeyRequestOptions(optRes.data);
      const cred = await navigator.credentials.get({ publicKey });
      if (!cred) throw new Error('cancelled');
      const verifyRes = await supa.functions.invoke('webauthn-auth', {
        body: { action: 'verify', email, credential: credentialGetToJSON(cred) },
      });
      if (verifyRes.error || !verifyRes.data || !verifyRes.data.verified || !verifyRes.data.token_hash) {
        show('Verifica non riuscita — usa la password.');
        return;
      }
      const { error: otpErr } = await supa.auth.verifyOtp({ email, token_hash: verifyRes.data.token_hash, type: 'magiclink' });
      if (otpErr) { show('Non sono riuscito ad aprire la sessione — usa la password.'); return; }
      // onAuthStateChange ri-renderizza da solo
    } catch (e) {
      show('Accesso con Face ID non riuscito — usa la password.');
    }
  }

  /* ---------- LOGIN GATE ---------- */
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
        ${passkeySupported() ? `<button class="pill pill--ghost" id="passkeyLoginBtn">Sblocca con Face ID →</button>` : ''}
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
        .then(({ error }) => {
          btn.disabled = false;
          if (error) { msg.hidden = false; msg.textContent = error.message === 'Invalid login credentials' ? 'Email o password non corrette.' : error.message; }
        });
    });

    const passkeyBtn = document.getElementById('passkeyLoginBtn');
    if (passkeyBtn) {
      passkeyBtn.addEventListener('click', () => {
        const email = document.querySelector('#loginForm input[name="email"]').value.trim();
        loginWithPasskey(email, document.getElementById('loginMsg'));
      });
    }

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
      supa.auth.updateUser({ password: fd.get('password') }).then(({ error }) => {
        btn.disabled = false;
        if (error) { msg.hidden = false; msg.textContent = error.message; return; }
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
        ${passkeySupported() ? `<button class="pill pill--ghost" id="passkeySetupBtn">Attiva Face ID →</button>` : ''}
      </div>
      <p class="msg" id="passkeyMsg" hidden></p>
      <div class="admin__tiles" id="tiles"><p class="msg">Carico i dati…</p></div>
      <div class="admin__chart-wrap"><canvas id="chart" height="90"></canvas></div>
      <div class="admin__tables" id="tables"></div>`;

    app.querySelectorAll('[data-period]').forEach((btn) => {
      btn.addEventListener('click', () => renderDashboard(btn.dataset.period));
    });
    const setupBtn = document.getElementById('passkeySetupBtn');
    if (setupBtn) setupBtn.addEventListener('click', () => setupPasskey(document.getElementById('passkeyMsg')));

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
    const { data: { session } } = await supa.auth.getSession();
    if (!session) { renderLoginGate(); return; }
    const { data } = await supa.from('admins').select('user_id').eq('user_id', session.user.id).maybeSingle();
    if (!data) { renderNotAdmin(); return; }
    renderDashboard('week');
  }

  supa.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') { renderRecoveryGate(); return; }
    if (event !== 'INITIAL_SESSION') checkAndRender();
  });
  logoutBtn.addEventListener('click', () => supa.auth.signOut().then(() => checkAndRender()));

  checkAndRender();
})();
