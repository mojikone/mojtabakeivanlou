// Pure and browser-safe: no Node-only imports. Used by the Node build and by the admin UI.
//
// The contact page: the enquiry form, the contact details and the business card. The form's keys, subject and
// redirect come from `site.site`, the options and the heading from `contactPage`, the details from `profile`.
// What stays here is page furniture (the field labels and placeholders, the button text, the page's own CSS and script).

import { html, raw, frag, fill, plainText } from './html.mjs';
import { icon } from './icons.mjs';
import { renderHead } from './head.mjs';
import { businessCard, downloadCvOnclick, heading } from './index.mjs';
import { topbar } from './topbar.mjs';

// The page's own CSS, on top of main.css. Code, not content.
const STYLE = String.raw`
  /* ── Contact page additions ── */
  .contact-page {
    background: var(--bg);
    min-height: 100svh;
    padding: calc(var(--topbar-h) + 60px) var(--pad) clamp(80px,10vw,120px);
  }
  .contact-layout {
    max-width: var(--max-w);
    margin: 0 auto;
    display: grid;
    grid-template-columns: 1fr 360px;
    gap: clamp(40px,6vw,100px);
    align-items: start;
  }
  .contact-heading {
    font-size: clamp(48px,8vw,112px);
    font-weight: 300;
    line-height: 0.93;
    letter-spacing: -0.03em;
    color: var(--text);
    margin-bottom: 40px;
  }
  .contact-heading .lime { color: var(--lime-dk); }

  /* form */
  .contact-form { display: flex; flex-direction: column; gap: 16px; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .form-group { display: flex; flex-direction: column; gap: 6px; }
  .form-group label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-2); }
  .form-group input,
  .form-group select,
  .form-group textarea {
    font-family: 'Poppins', sans-serif;
    font-size: 14px;
    color: var(--text);
    background: var(--white);
    border: 1.5px solid rgba(20,20,20,0.14);
    border-radius: 10px;
    padding: 12px 16px;
    transition: border-color 0.2s;
    outline: none;
    appearance: none;
    -webkit-appearance: none;
  }
  .form-group input:focus,
  .form-group select:focus,
  .form-group textarea:focus { border-color: var(--lime-dk); }
  .form-group textarea { resize: vertical; min-height: 140px; }
  .form-group select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B65' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 14px center;
    padding-right: 40px;
    cursor: pointer;
  }
  .form-submit-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 8px; }
  .form-note { font-size: 12px; color: var(--text-2); }
  .form-required { color: var(--lime-dk); }

  /* sidebar */
  .contact-sidebar { position: sticky; top: calc(var(--topbar-h) + 32px); }
  .sidebar-block { margin-bottom: 36px; }
  .sidebar-block-title { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-2); margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
  .sidebar-block-title::before { content: ''; display: block; width: 20px; height: 1.5px; background: currentColor; }
  .sidebar-contact-item {
    display: flex; align-items: flex-start; gap: 10px;
    font-size: 14px; color: var(--text); margin-bottom: 10px;
    line-height: 1.4;
  }
  .sidebar-contact-item a { color: var(--text); transition: color 0.2s; }
  .sidebar-contact-item a:hover { color: var(--lime-dk); }
  .sidebar-contact-icon { flex-shrink: 0; color: var(--text-2); margin-top: 1px; }
  .sidebar-divider { border: none; border-top: 1px solid rgba(20,20,20,0.1); margin: 24px 0; }

  /* business card — sidebar context overrides */
  .sidebar-biz-card { margin: 0; max-width: 100%; }
  .sidebar-biz-card .card-scene { width: 100%; aspect-ratio: 90/55; perspective: 900px; }
  .sidebar-biz-card .card-flip { width: 100%; height: 100%; position: relative; transform-style: preserve-3d; transition: transform 0.7s cubic-bezier(.4,.2,.2,1); cursor: pointer; }
  .sidebar-biz-card .card-flip.flipped { transform: rotateY(180deg); }
  @media (hover: hover) {
    .sidebar-biz-card .card-flip:hover { transform: rotateY(180deg); }
    .sidebar-biz-card .biz-card-flip-hint { display: none; }
  }

  /* mobile: show Back to CV */
  @media (max-width: 860px) {
    .topbar-cta { display: inline-flex !important; }
  }

  @media (max-width: 860px) {
    .contact-layout { grid-template-columns: 1fr; }
    .contact-sidebar { position: static; }
    .form-row { grid-template-columns: 1fr; }
  }
`;

// Fills in the local time on submit, flips the business card on touch screens and opens WhatsApp the way the device
// wants it (the app on phones, WhatsApp Web on desktops). Code, not content: carried over from the original page.
const SCRIPT = String.raw`<script>
  // Populate local time on submit
  document.getElementById('contact-form').addEventListener('submit', function () {
    var d = new Date();
    document.getElementById('local-time').value =
      d.toLocaleString('en-GB', { timeZone: 'Asia/Muscat', dateStyle: 'medium', timeStyle: 'short' });
  });

  // Business card flip — touch only (hover handles desktop)
  var bizCard = document.getElementById('biz-card-main');
  if (bizCard) {
    bizCard.addEventListener('click', function () {
      if (!window.matchMedia('(hover: hover)').matches) {
        bizCard.classList.toggle('flipped');
      }
    });
  }

  // WhatsApp: open the app on phones (incl. desktop-site mode), WhatsApp Web on desktop
  document.querySelectorAll('a[href*="wa.me"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var match = a.href.match(/wa\.me\/(\d+)/);
      if (!match) return;
      e.preventDefault();
      // Phones in "desktop site" mode report a desktop user agent, so also treat
      // a touch-first device with no hover (not a laptop) as mobile.
      var mq = function (q) { return window.matchMedia && window.matchMedia(q).matches; };
      var isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 0 && mq('(pointer: coarse)') && mq('(hover: none)'));
      if (!isMobile) {
        window.open('https://web.whatsapp.com/send?phone=' + match[1], '_blank');
        return;
      }
      // Open the WhatsApp app; if it isn't installed the page stays visible, so fall back to wa.me.
      var timer = setTimeout(function () {
        if (!document.hidden) window.location.href = a.href;
      }, 1500);
      var cancel = function () { clearTimeout(timer); };
      window.addEventListener('pagehide', cancel, { once: true });
      window.addEventListener('blur', cancel, { once: true });
      document.addEventListener('visibilitychange', cancel, { once: true });
      window.location.href = 'whatsapp://send?phone=' + match[1];
    });
  });
</script>`;

function form(site, ctx) {
  const settings = site.site;
  const page = site.contactPage;
  return frag`<!-- FORM SIDE -->
    <div>
      <h1 class="contact-heading">${heading(page.heading, ctx)}</h1>

      <form class="contact-form" action="https://api.web3forms.com/submit" method="POST" id="contact-form">
        <input type="hidden" name="access_key" value="${settings.web3formsKey}">
        <input type="hidden" name="subject" value="${fill(settings.formSubject, ctx)}">
        <input type="hidden" name="redirect" value="https://${settings.domain}/thank-you.html">
        <input type="hidden" name="local-time" id="local-time">
        <input type="checkbox" name="botcheck" style="display:none;">

        <div class="form-row">
          <div class="form-group">
            <label>Full Name <span class="form-required">*</span></label>
            <input type="text" name="name" placeholder="Your full name" required>
          </div>
          <div class="form-group">
            <label>Email Address <span class="form-required">*</span></label>
            <input type="email" name="email" placeholder="your@email.com" required>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Phone / WhatsApp</label>
            <input type="tel" name="phone" placeholder="+1 234 567 8900">
          </div>
          <div class="form-group">
            <label>Organisation</label>
            <input type="text" name="organisation" placeholder="Company or institution">
          </div>
        </div>

        <div class="form-group">
          <label>Project Type <span class="form-required">*</span></label>
          <select name="project_type" required>
            <option value="" disabled selected>Select project type…</option>
${page.projectTypes.map((type) => frag`            <option>${fill(type, ctx)}</option>
`)}          </select>
        </div>

        <div class="form-group">
          <label>Project Description <span class="form-required">*</span></label>
          <textarea name="description" placeholder="${fill(page.descriptionPlaceholder, ctx)}" required></textarea>
        </div>

        <div class="form-submit-row">
          <button type="submit" class="btn-lime">
            Send Enquiry
            ${icon('send')}
          </button>
          <span class="form-note"><span class="form-required">*</span> Required fields</span>
        </div>
      </form>
    </div>
`;
}

function sidebar(site, ctx) {
  const p = site.profile;
  const t = (text) => plainText(text, ctx);
  const iconAttrs = { class: 'sidebar-contact-icon', width: '14', height: '14' };
  const item = (name, content) => frag`        <div class="sidebar-contact-item">
          ${icon(name, iconAttrs)}
          <div>${content}</div>
        </div>
`;
  const link = (href, label, external) => frag`<a href="${href}"${external && raw(' target="_blank" rel="noopener"')}>${label}</a>`;
  const items = [
    item('mail', link(`mailto:${p.email}`, t(p.email))),
    item('phone', link(`tel:${p.phone.e164}`, t(p.phone.display))),
    item('whatsapp', link(`https://wa.me/${p.whatsapp}`, 'WhatsApp', true)),
    item('linkedin', link(p.linkedin, 'LinkedIn', true)),
    item('pinFilled', frag`${t(p.location.city)}, ${t(p.location.country)}`),
  ];
  return frag`<!-- SIDEBAR -->
    <div class="contact-sidebar">

      <div class="sidebar-block">
${items}      </div>

      <hr class="sidebar-divider">

      <div class="sidebar-block">
        <a class="btn-lime" href="cv.html" target="_blank" rel="noopener" onclick="${downloadCvOnclick(site)}" style="width:100%;justify-content:center;">
          ${icon('download', { width: '13', height: '13' })}
          Download CV
        </a>
      </div>

      <hr class="sidebar-divider">

      <div class="sidebar-block">
        ${businessCard(site, ctx, 'sidebar-biz-card')}
      </div>

    </div>
`;
}

/** The whole contact page. */
export function renderContact(site, ctx) {
  const head = renderHead({
    site,
    ctx,
    page: 'contact',
    title: fill(site.seo.titleContact, ctx),
    description: fill(site.seo.descriptionContact, ctx),
    canonicalPath: 'contact.html',
    inlineStyles: [STYLE],
  });
  return html`${raw(head)}<body>

<!-- TOP BAR -->
${topbar(ctx, { onLight: true })}

<!-- CONTACT PAGE -->
<div class="contact-page">
  <div class="contact-layout">

    ${form(site, ctx)}
    ${sidebar(site, ctx)}
  </div>
</div>

${raw(SCRIPT)}
</body>
</html>
`;
}
