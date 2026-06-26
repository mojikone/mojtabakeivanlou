(function () {
  'use strict';

  /* ── TOPBAR: light/dark state based on section bg ─────── */
  var topbar = document.getElementById('topbar');
  var lightSections = ['home', 'about', 'experience', 'contact'];

  function updateTopbar() {
    if (!topbar) return;
    var y = window.scrollY + 80;
    var onLight = false;
    lightSections.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (y >= el.offsetTop && y < el.offsetTop + el.offsetHeight) onLight = true;
    });
    topbar.classList.toggle('on-light', onLight);
  }
  window.addEventListener('scroll', updateTopbar, { passive: true });
  updateTopbar();

  /* ── MOBILE HAMBURGER ─────────────────────────────────── */
  var hamburger = document.getElementById('topbar-hamburger');
  var drawer    = document.getElementById('nav-drawer');
  var drawerClose = document.getElementById('nav-drawer-close');

  function openDrawer() {
    if (!drawer) return;
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'true');
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    if (hamburger) hamburger.setAttribute('aria-expanded', 'false');
  }

  if (hamburger) hamburger.addEventListener('click', openDrawer);
  if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
  if (drawer) {
    drawer.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', closeDrawer);
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });

  /* ── SMOOTH SCROLL (RAF) ──────────────────────────────── */
  function smoothTo(targetY) {
    var startY = window.scrollY;
    var dist   = targetY - startY;
    var dur    = Math.min(Math.max(Math.abs(dist) * 0.38, 380), 900);
    var start  = null;
    function ease(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }
    function step(ts) {
      if (!start) start = ts;
      var pct = Math.min((ts - start) / dur, 1);
      window.scrollTo(0, startY + dist * ease(pct));
      if (pct < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var href = a.getAttribute('href');
      var target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        smoothTo(href === '#home' ? 0 : target.offsetTop);
      }
    });
  });

  /* ── PILL NAV: active link ────────────────────────────── */
  var sections = document.querySelectorAll('section[id]');
  var pillLinks = document.querySelectorAll('.pill-nav a');

  function updateActivePill() {
    var active = sections[0];
    sections.forEach(function (s) {
      if (s.getBoundingClientRect().top <= 10) active = s;
    });
    pillLinks.forEach(function (a) { a.classList.remove('active'); });
    var link = document.querySelector('.pill-nav a[href="#' + active.id + '"]');
    if (link) link.classList.add('active');
  }
  window.addEventListener('scroll', updateActivePill, { passive: true });
  updateActivePill();
  requestAnimationFrame(updateActivePill);

  /* ── REVEAL ON SCROLL ─────────────────────────────────── */
  var revealObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        revealObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.07 });
  document.querySelectorAll('.reveal').forEach(function (el) { revealObs.observe(el); });

  setTimeout(function () {
    document.querySelectorAll('.reveal:not(.in)').forEach(function (el) { el.classList.add('in'); });
  }, 1500);

  /* ── HERO SCROLL FADE ─────────────────────────────────── */
  var heroEl = document.querySelector('.hero');
  if (heroEl) {
    window.addEventListener('scroll', function () {
      var ratio = Math.min(window.scrollY / heroEl.offsetHeight, 1);
      heroEl.style.opacity = 1 - ratio * 1.5;
    }, { passive: true });
  }

  /* ── WHATSAPP DESKTOP ─────────────────────────────────── */
  document.querySelectorAll('a[href*="wa.me"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (!isMobile) {
        e.preventDefault();
        var match = a.href.match(/wa\.me\/(\d+)/);
        if (match) window.open('https://web.whatsapp.com/send?phone=' + match[1], '_blank');
      }
    });
  });

})();

/* ── BUSINESS CARD FLIP ───────────────────────────────────── */
var bizCardMain = document.getElementById('biz-card-main');
if (bizCardMain) {
  bizCardMain.addEventListener('click', function () { this.classList.toggle('flipped'); });
}

/* ── TIMELINE ACCORDION ───────────────────────────────────── */
function toggleExp(btn) {
  var item   = btn.closest('.tl-item');
  var span   = btn.querySelector('span');
  var isOpen = item.classList.contains('exp-open');
  var orig   = span.dataset.orig || span.textContent;
  span.dataset.orig = orig;
  item.classList.toggle('exp-open');
  btn.setAttribute('aria-expanded', String(!isOpen));
  span.textContent = isOpen ? orig : 'Collapse';
}

/* ── Image fade-in on load ────────────────────────────────── */
document.querySelectorAll('.fade-img').forEach(function(img) {
  if (img.complete && img.naturalWidth) {
    img.classList.add('loaded');
  } else {
    img.addEventListener('load', function() { img.classList.add('loaded'); });
    img.addEventListener('error', function() { img.classList.add('loaded'); });
  }
});
