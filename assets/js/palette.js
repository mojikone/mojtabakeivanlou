/* ─── PALETTE SWITCHER + FIREBASE GLOBAL DEFAULT ─────────────────────
   Static-site palette switcher for GitHub Pages.

   • PUBLIC visitors: click the "o" in "Mojtaba" → pick a color. This is
     a LOCAL preview only (saved in their own browser via localStorage).
     It never affects anyone else.
   • YOU (signed in as admin): the same "o" panel writes the choice to
     Firebase → it becomes the GLOBAL default everyone sees, live.

   Firebase is OPTIONAL. With no config below, the site runs in
   local-only mode — identical to the non-Firebase version. Paste your
   config + UID to switch the global/admin powers on.

   ┌──────────────────────────────────────────────────────────────┐
   │  GLOBAL DEFAULT (no Firebase): edit DEFAULT_ID, bump ?v=, push │
   │  ids: green brown teal navy slate char forest petrol           │
   └──────────────────────────────────────────────────────────────┘
   Loaded synchronously in <head> so the color lands before first
   paint (no flash). Firebase SDK is loaded lazily, after paint.
   ------------------------------------------------------------------ */
(function () {
  'use strict';

  if (window.__mkPaletteLoaded) return;        // guard against double-include
  window.__mkPaletteLoaded = true;

  /* ════════════════════ CONFIG ════════════════════ */

  // Site-wide default when there is no Firebase value and no personal pick.
  var DEFAULT_ID = 'green';
  // Bump to force a new default onto visitors who previously picked locally.
  var DEFAULT_VERSION = 1;

  // ▼▼▼ FIREBASE WEB CONFIG ▼▼▼
  //  NOTE: databaseURL is still REQUIRED and missing below — it appears
  //  once you create the Realtime Database. Paste it in, and Firebase
  //  auto-activates (FIREBASE_ENABLED flips true when databaseURL is set).
  var firebaseConfig = {
    apiKey:            "AIzaSyCCr8Y3YQToyklJib0l8iuvqKjvCCmrXkw",
    authDomain:        "mojtaba-website.firebaseapp.com",
    databaseURL:       "https://mojtaba-website-default-rtdb.europe-west1.firebasedatabase.app",
    projectId:         "mojtaba-website",
    storageBucket:     "mojtaba-website.firebasestorage.app",
    messagingSenderId: "58085451180",
    appId:             "1:58085451180:web:13b349e71d86a0bbeb0609"
  };
  // Your Firebase user UID (from Authentication → Users after you sign in
  // once). Only this account can change the GLOBAL color.
  var ADMIN_UID = 'NwAyuKJcNFafK5m0ldbbrQeQxVh2';
  // ▲▲▲

  var FB_SDK_VER = '10.12.2';
  var DB_PATH = 'siteConfig/palette';
  var FIREBASE_ENABLED = !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.databaseURL);

  /* ════════════════════ STORAGE KEYS ════════════════════ */
  var STORAGE_KEY = 'mk-palette';     // this visitor's personal local override
  var VERSION_KEY = 'mk-palette-v';
  var GLOBAL_CACHE_KEY = 'mk-global'; // last-known global default (for no-flash)

  /* ════════════════════ PALETTES ════════════════════ */
  var PALETTES = [
    { id: 'green',  name: 'Original (lime)',     bg:'#EDEBE7', bg2:'#E3E1DC', dk:'#1A3D2C', dk2:'#153325', text:'#141414', text2:'#6B6B65', textLt:'#EBE9E4', lime:'#A8CE2E', limeDk:'#8EB020', hero:'#EAF3C5' },
    { id: 'brown',  name: 'Brown + caramel',     bg:'#EFEAE2', bg2:'#E6DDD0', dk:'#3A2A1E', dk2:'#2C1F16', text:'#1A130D', text2:'#6E6155', textLt:'#EFE7DC', lime:'#D99A3C', limeDk:'#9C6B1A', hero:'#F2E7CD' },
    { id: 'teal',   name: 'Teal + copper',       bg:'#F0EBE2', bg2:'#E6DFD2', dk:'#0F3B38', dk2:'#0A2C2A', text:'#16201F', text2:'#5E6A68', textLt:'#E8EFEC', lime:'#C2703D', limeDk:'#A65A2C', hero:'#F1E2D4' },
    { id: 'navy',   name: 'Navy + brass',        bg:'#F2EEE4', bg2:'#E8E2D4', dk:'#16233F', dk2:'#0F1A30', text:'#141821', text2:'#5F6573', textLt:'#ECEFF5', lime:'#C9A24B', limeDk:'#9A7A2E', hero:'#F1E8D2' },
    { id: 'slate',  name: 'Slate + amber',       bg:'#EDEDEF', bg2:'#E2E3E6', dk:'#3A4756', dk2:'#2B3742', text:'#1B2026', text2:'#5E6671', textLt:'#EAECEF', lime:'#E0A338', limeDk:'#B07D1E', hero:'#F4E8CE' },
    { id: 'char',   name: 'Charcoal + rust',     bg:'#EFEAE0', bg2:'#E4DED2', dk:'#2A2A2C', dk2:'#1C1C1E', text:'#1A1A1B', text2:'#65625C', textLt:'#ECEAE4', lime:'#C75A2E', limeDk:'#A2451F', hero:'#F3E0D5' },
    { id: 'forest', name: 'Forest + gold',       bg:'#EFEADC', bg2:'#E5DEC9', dk:'#1E3A2B', dk2:'#142A1F', text:'#16201A', text2:'#5F665C', textLt:'#EAEFE6', lime:'#C9A227', limeDk:'#927316', hero:'#F1E9CC' },
    { id: 'petrol', name: 'Petrol + terracotta', bg:'#EFE7D8', bg2:'#E5DBC7', dk:'#173F4A', dk2:'#102E37', text:'#16201F', text2:'#5E6864', textLt:'#E9EFEC', lime:'#C36A4A', limeDk:'#9E4F33', hero:'#F2E2D6' }
  ];

  /* ════════════════════ HELPERS ════════════════════ */
  function hexToRgb(hex) {
    var h = hex.replace('#', '');
    return parseInt(h.substring(0, 2), 16) + ',' +
           parseInt(h.substring(2, 4), 16) + ',' +
           parseInt(h.substring(4, 6), 16);
  }
  function byId(id) {
    for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) return PALETTES[i];
    return null;
  }
  function apply(p) {
    if (!p) return;
    var s = document.documentElement.style;
    s.setProperty('--bg', p.bg);
    s.setProperty('--bg2', p.bg2);
    s.setProperty('--dk', p.dk);
    s.setProperty('--dk2', p.dk2);
    s.setProperty('--text', p.text);
    s.setProperty('--text-2', p.text2);
    s.setProperty('--text-lt', p.textLt);
    s.setProperty('--lime', p.lime);
    s.setProperty('--lime-dk', p.limeDk);
    s.setProperty('--hero', p.hero);
    s.setProperty('--lime-rgb', hexToRgb(p.lime));
    s.setProperty('--dk-rgb', hexToRgb(p.dk));
    s.setProperty('--lt-rgb', hexToRgb(p.textLt));
    s.setProperty('--text-rgb', hexToRgb(p.text));
    updateFavicon(p);
  }
  function updateFavicon(p) {
    var link = document.querySelector('link[rel="icon"]');
    if (!link) return;
    var box = p.dk.replace('#', '%23');
    var txt = p.lime.replace('#', '%23');
    link.setAttribute('href',
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E" +
      "%3Crect width='100' height='100' rx='14' fill='" + box + "'/%3E" +
      "%3Ctext x='50' y='67' font-family='sans-serif' font-weight='700' font-size='44' " +
      "text-anchor='middle' fill='" + txt + "'%3EMK%3C/text%3E%3C/svg%3E");
  }

  /* ════════════════════ STORAGE ════════════════════ */
  function getPersonalId() {
    try {
      if (String(localStorage.getItem(VERSION_KEY)) !== String(DEFAULT_VERSION)) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.setItem(VERSION_KEY, String(DEFAULT_VERSION));
        return null;
      }
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) { return null; }
  }
  function savePersonal(id) {
    try { localStorage.setItem(STORAGE_KEY, id); localStorage.setItem(VERSION_KEY, String(DEFAULT_VERSION)); } catch (e) {}
  }
  function clearPersonal() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }
  function getGlobalCache() {
    try { return localStorage.getItem(GLOBAL_CACHE_KEY); } catch (e) { return null; }
  }
  function setGlobalCache(id) {
    try { localStorage.setItem(GLOBAL_CACHE_KEY, id); } catch (e) {}
  }

  /* ════════════════════ INITIAL SYNC APPLY (no flash) ════════════════════
     Precedence: this visitor's personal pick → last-known global → default. */
  var currentId = getPersonalId() || getGlobalCache() || DEFAULT_ID;
  if (!byId(currentId)) currentId = DEFAULT_ID;
  apply(byId(currentId));

  /* ════════════════════ FIREBASE / ADMIN STATE ════════════════════ */
  var isAdmin = false;
  var currentUser = null;
  var dbRef = null;
  var fbAuth = null;
  var panel = null, footer = null;

  /* ════════════════════ UI ════════════════════ */
  function setActive(id) {
    if (!panel) return;
    panel.querySelectorAll('.palette-opt').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-id') === id);
    });
  }

  // A color was chosen from the panel.
  function selectColor(id) {
    var p = byId(id);
    if (!p) return;
    if (isAdmin && dbRef) {
      // Admin → publish globally. Clear personal override so we track global.
      clearPersonal();
      try { dbRef.set(id); } catch (e) { console.warn('[palette] write failed', e); }
      currentId = id; apply(p); setActive(id);   // optimistic; listener confirms
    } else {
      // Public → local preview only.
      savePersonal(id);
      currentId = id; apply(p); setActive(id);
    }
  }

  function resetToSiteDefault() {
    clearPersonal();
    var id = getGlobalCache() || DEFAULT_ID;
    currentId = id; apply(byId(id)); setActive(id);
    updateAuthUI();
  }

  function updateAuthUI() {
    if (!footer) return;
    footer.innerHTML = '';
    var hasPersonal = !!getPersonalId();

    // Public visitor with a local override → offer reset.
    if (hasPersonal && (FIREBASE_ENABLED || getGlobalCache())) {
      var reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'palette-foot-link';
      reset.textContent = 'Reset to site default';
      reset.addEventListener('click', resetToSiteDefault);
      footer.appendChild(reset);
    }

    if (!FIREBASE_ENABLED) return;

    if (isAdmin) {
      var badge = document.createElement('div');
      badge.className = 'palette-admin-badge';
      badge.textContent = 'Admin — picks go live for everyone';
      footer.appendChild(badge);
      var out = document.createElement('button');
      out.type = 'button';
      out.className = 'palette-foot-link';
      out.textContent = 'Sign out';
      out.addEventListener('click', function () { try { fbAuth.signOut(); } catch (e) {} });
      footer.appendChild(out);
    } else if (currentUser) {
      // Signed in but not yet recognized as admin — show UID for setup.
      var who = document.createElement('div');
      who.className = 'palette-admin-badge';
      who.textContent = 'Signed in — your UID:';
      footer.appendChild(who);

      var uid = document.createElement('code');
      uid.textContent = currentUser.uid;
      uid.title = 'Click to select, then copy';
      uid.style.cssText = 'display:block;font-size:11px;word-break:break-all;' +
        'background:rgba(var(--text-rgb),0.06);padding:6px 8px;border-radius:6px;' +
        'margin:2px 0 6px;cursor:pointer;color:var(--text);';
      uid.addEventListener('click', function () {
        var range = document.createRange(); range.selectNodeContents(uid);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        try { document.execCommand('copy'); } catch (e) {}
      });
      footer.appendChild(uid);

      var out2 = document.createElement('button');
      out2.type = 'button';
      out2.className = 'palette-foot-link';
      out2.textContent = 'Sign out';
      out2.addEventListener('click', function () { try { fbAuth.signOut(); } catch (e) {} });
      footer.appendChild(out2);
    } else {
      var signin = document.createElement('button');
      signin.type = 'button';
      signin.className = 'palette-foot-link';
      signin.textContent = 'Sign in to set site-wide';
      signin.addEventListener('click', function () {
        try {
          var prov = new firebase.auth.GoogleAuthProvider();
          fbAuth.signInWithPopup(prov)['catch'](function (e) { console.warn('[palette] sign-in', e); });
        } catch (e) { console.warn('[palette] sign-in', e); }
      });
      footer.appendChild(signin);
    }
  }

  function initUI() {
    var trigger = document.getElementById('paletteTrigger');
    if (!trigger) return;   // pages without the "o" still honor saved/global palette

    panel = document.createElement('div');
    panel.className = 'palette-panel';
    panel.setAttribute('role', 'menu');

    var title = document.createElement('div');
    title.className = 'palette-panel-title';
    title.textContent = 'Color theme';
    panel.appendChild(title);

    PALETTES.forEach(function (p) {
      var opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'palette-opt' + (p.id === currentId ? ' active' : '');
      opt.setAttribute('role', 'menuitemradio');
      opt.setAttribute('data-id', p.id);

      var sw = document.createElement('span');
      sw.className = 'palette-swatch';
      [p.bg, p.dk, p.lime].forEach(function (c) {
        var seg = document.createElement('span'); seg.style.background = c; sw.appendChild(seg);
      });
      opt.appendChild(sw);

      var label = document.createElement('span');
      label.textContent = p.name;
      opt.appendChild(label);

      var check = document.createElement('span');
      check.className = 'palette-opt-check';
      check.innerHTML = "<svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>";
      opt.appendChild(check);

      opt.addEventListener('click', function () { selectColor(p.id); updateAuthUI(); });
      panel.appendChild(opt);
    });

    footer = document.createElement('div');
    footer.className = 'palette-foot';
    panel.appendChild(footer);
    updateAuthUI();

    var anchor = trigger.closest('.hero-name-over') || trigger.parentNode;
    anchor.style.position = anchor.style.position || 'absolute';
    anchor.appendChild(panel);

    function openPanel() { panel.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); }
    function closePanel() { panel.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); }

    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel.classList.contains('open')) closePanel(); else openPanel();
    });
    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== trigger) closePanel();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
  }

  /* ════════════════════ FIREBASE ════════════════════ */
  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src; s.async = true; s.onload = cb;
    s.onerror = function () { console.warn('[palette] could not load', src); };
    document.head.appendChild(s);
  }
  function initFirebase() {
    if (!FIREBASE_ENABLED) return;
    var base = 'https://www.gstatic.com/firebasejs/' + FB_SDK_VER + '/';
    loadScript(base + 'firebase-app-compat.js', function () {
      loadScript(base + 'firebase-auth-compat.js', function () {
        loadScript(base + 'firebase-database-compat.js', startFirebase);
      });
    });
  }
  function startFirebase() {
    try {
      firebase.initializeApp(firebaseConfig);
      dbRef = firebase.database().ref(DB_PATH);
      // Live global default — everyone reads this.
      dbRef.on('value', function (snap) {
        var id = snap.val();
        if (id && byId(id)) {
          setGlobalCache(id);
          if (!getPersonalId()) { currentId = id; apply(byId(id)); setActive(id); }
        }
      });
      // Auth — only ADMIN_UID may write (also enforced by DB security rules).
      fbAuth = firebase.auth();
      fbAuth.onAuthStateChanged(function (user) {
        currentUser = user || null;
        isAdmin = !!(user && user.uid === ADMIN_UID);
        if (user && !isAdmin) {
          console.info('[palette] Signed in. Your Firebase UID is:', user.uid,
                       '— paste it into ADMIN_UID (palette.js) and the database rules.');
        }
        updateAuthUI();
      });
    } catch (e) { console.warn('[palette] firebase init failed', e); }
  }

  /* ════════════════════ BOOT ════════════════════ */
  function boot() { initUI(); initFirebase(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
