// Pure and browser-safe: no Node-only imports. Used by the Node build and by the admin UI.
//
// The home page. Every text comes from site.json; what stays here is page furniture (section titles, button and
// pill labels, image paths, the QR codes) that the content model deliberately does not cover.

import { html, raw, esc, fill, inlineText, richText } from './html.mjs';
import { icon } from './icons.mjs';
import { sortedTags } from './model.mjs';
import { renderHead, indexJsonLd, jsString, OG_IMAGE } from './head.mjs';

// The business card's QR code (https://mojtabakeivanlou.com) in the dark and light card themes. Not content.
const QR_DARK = 'data:image/png;base64,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';
const QR_LIGHT = 'data:image/png;base64,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';

const SEP = ' &nbsp;&middot;&nbsp; ';

// html`` returns a string, which an enclosing html`` would escape; fragments are therefore Raw.
const frag = (strings, ...values) => raw(html(strings, ...values));

/**
 * A plain (not rich) text field: placeholders filled and escaped, the {{years}} count kept live as
 * <span data-years>, no **bold** or _italic_ markers.
 */
export function plainText(text, ctx) {
  return raw(String(text).split('{{years}}').map((part) => esc(fill(part, ctx))).join(`<span data-years>${ctx.years}</span>`));
}

// "a · b" (as stored) shown with the page's non-breaking separator.
const separated = (text, ctx) => raw(String(text).split(' · ').map((part) => plainText(part, ctx).html).join(SEP));

/**
 * The onclick of every "Download CV" button: opens cv.html (the href) and downloads the PDF at the same time.
 * Raw, so the attribute reads like the original: the filename goes through jsString, which leaves no quote, "&", "<"
 * or ">" for the attribute to escape.
 */
export function downloadCvOnclick(site) {
  const file = site.site.cvPdfFilename;
  return raw(`var a=document.createElement('a');a.href=${jsString(`pdf/${file}`)};a.download=${jsString(file)};document.body.appendChild(a);a.click();a.remove();`);
}

/** Bytes as "900 B", "12 KB", "4.2 MB" (binary units). */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function filesSpan(files, ctx) {
  if (!files?.length) return '';
  const links = files.map((file) => frag`<a class="proj-dl" href="#" data-file="${file.id}" data-name="${file.name}" data-size="${file.size}" data-enc="${file.enc ? 'true' : 'false'}" title="${file.name} · ${formatSize(file.size)}" aria-label="Download ${file.name}">${icon('download', { width: '13', height: '13' })}</a>`);
  return ctx.unlocked
    ? frag`<span class="proj-files">${links}</span>`
    : frag`<span class="proj-files" hidden>${links}</span>`;
}

// Two-line heading: the second line in the accent colour.
const heading = ([first, second], ctx) => frag`${plainText(first, ctx)}<br><span class="lime">${plainText(second, ctx)}</span>`;

// The palette picker hides in the second letter of the first name ("M[o]jtaba").
function nameWithTrigger(profile, ctx) {
  const first = Array.from(fill(profile.firstName, ctx));
  return frag`${first[0]}<button type="button" id="paletteTrigger" class="palette-o" aria-label="Change color theme" aria-haspopup="true" aria-expanded="false">${first[1] ?? ''}</button>${first.slice(2).join('')} ${fill(profile.lastName, ctx)}`;
}

const initials = (profile, ctx) => [profile.firstName, profile.lastName].map((part) => Array.from(fill(part, ctx))[0] ?? '').join('');

/** The flip business card of the contact section (also on contact.html). */
export function businessCard(site, ctx) {
  const p = site.profile;
  const t = (text) => plainText(text, ctx);
  const contactIcon = { width: '9', height: '9', 'stroke-width': '1.5' };
  return frag`<div class="biz-card-cta">
        <div class="card-scene">
          <div class="card-flip" id="biz-card-main">
            <!-- Front -->
            <div class="bc-card front">
              <div class="bc-accent"></div>
              <div class="circle1"></div>
              <div class="circle2"></div>
              <div class="bc-mk">${initials(p, ctx)}</div>
              <div class="bc-content">
                <div class="bc-left">
                  <div>
                    <div class="bc-name">${t(p.firstName)}<br><span>${t(p.lastName)}</span></div>
                    <div class="bc-rule"></div>
                    <div class="bc-title">${raw(p.businessCard.titleLines.map((line) => t(line).html).join('<br>'))}</div>
                  </div>
                  <div class="bc-contacts">
                    <div class="bc-contact-row">
                      ${icon('phone', contactIcon)}
                      ${t(p.phone.display)}
                    </div>
                    <div class="bc-contact-row">
                      ${icon('mail', contactIcon)}
                      ${t(p.email)}
                    </div>
                    <div class="bc-contact-row">
                      ${icon('pin')}
                      ${t(p.location.short)}
                    </div>
                    <div class="bc-contact-row">
                      ${icon('globe', { width: '9', height: '9' })}
                      ${t(site.site.domain)}
                    </div>
                  </div>
                </div>
                <div class="bc-right">
                  <div class="bc-qr">
                    <img class="bc-qr-dark" src="${QR_DARK}" alt="QR">
                    <img class="bc-qr-light" src="${QR_LIGHT}" alt="QR">
                  </div>
                </div>
              </div>
            </div>
            <!-- Back -->
            <div class="bc-card back bc-light">
              <div class="bc-content">
                <div class="bc-sec-header">
                  <span class="bc-sec-label">Services</span>
                  <div class="bc-hrule"></div>
                </div>
                <div class="bc-grid">
${p.businessCard.cells.map((cell) => frag`                  <div class="bc-cell">${icon(cell.icon, { width: '17.2', height: '17.2' })}<span class="bc-cell-label">${t(cell.label)}</span></div>
`)}                </div>
              </div>
            </div>
          </div>
        </div>
        <p class="biz-card-flip-hint">Tap to flip</p>
      </div>`;
}

function hero(site, ctx) {
  const p = site.profile;
  const t = (text) => plainText(text, ctx);
  const onclick = downloadCvOnclick(site);
  return frag`<!-- ══ HERO ═════════════════════════════════════════════════ -->
<section class="hero" id="home">
  <img src="assets/img/hero-waterfront4-gray-lq.png"
       alt="" aria-hidden="true" class="hero-photo-main hero-ph">
  <img src="assets/img/mojtaba-waterfront4-gray.webp?v=2"
       alt="${ctx.name}" class="hero-photo-main fade-img" loading="eager">

  <!-- Name on top of photo -->
  <div class="hero-name-over">
    <p class="hero-name-over-text">${nameWithTrigger(p, ctx)}</p>
  </div>

  <!-- Center: large role headline -->
  <div class="hero-center-block">
    <p class="hero-role-headline">${t(p.heroHeadline[0])}<br>${t(p.heroHeadline[1])}</p>
  </div>

  <!-- Bottom-right: contact + buttons -->
  <div class="hero-br">
    <div class="hero-contact-row">
      <a class="hero-contact-link" href="mailto:${p.email}">
        ${icon('mail')}
        ${t(p.email)}
      </a>
      <a class="hero-contact-link" href="tel:${p.phone.e164}">
        ${icon('phone')}
        ${t(p.phone.display)}
      </a>
      <a class="hero-contact-link" href="https://wa.me/${p.whatsapp}" target="_blank" rel="noopener">
        ${icon('whatsapp')}
        WhatsApp
      </a>
      <div class="hero-contact-link access-pill" id="accessPill" data-state="idle">
        <button type="button" class="access-pill-main" aria-expanded="false">${icon('key', { width: '10', height: '10' })}<span class="access-pill-label">Access</span></button>
        <form class="access-pill-form" hidden autocomplete="off">
          <input type="password" name="code" placeholder="Access code" aria-label="Access code" autocomplete="off" autocapitalize="off" spellcheck="false">
          <button type="submit">Enter</button>
        </form>
      </div>
    </div>
    <div class="hero-br-actions">
      <a class="btn-lime" href="contact.html">Start a Project &rarr;</a>
      <a class="btn-outline" href="cv.html" target="_blank" rel="noopener" onclick="${onclick}">
        ${icon('download')}
        Download CV
      </a>
    </div>
  </div>
</section>
`;
}

function about(site, ctx) {
  const p = site.profile;
  const t = (text) => plainText(text, ctx);
  return frag`<!-- ══ ABOUT ═════════════════════════════════════════════════ -->
<section class="about" id="about">
  <div class="about-inner">

    <div class="about-right reveal d2">
      <img src="assets/img/hydraulic-illustration-lq.png"
           alt="" aria-hidden="true" class="about-illus-lq" id="about-illus-lq">
      <img src="assets/img/hydraulic-illustration.webp"
           onerror="this.src='assets/img/dam drone artwork2.png'"
           onload="var lq=document.getElementById('about-illus-lq'); if(lq) lq.style.opacity='0';"
           alt="Hydraulic engineering illustration" class="about-illus-hq" loading="lazy">
    </div>

    <div class="about-text reveal">
      <div class="eyebrow">About Me</div>
      <h2 class="about-title">${t(p.roleTitleLong)}</h2>
      <div class="about-subtitle-role">${t(p.roleSubtitle)}</div>
      <p class="about-quote">${inlineText(p.quote, ctx)}</p>
      <div class="about-bio">
        ${richText(p.bio, ctx)}
      </div>
      <div class="edu-block">
        <div class="eyebrow">Education</div>
        <div class="edu-list">
${site.education.map((edu) => frag`          <div class="edu-item">
            <div>
              <div class="edu-deg">${t(edu.degree)}</div>
              <div class="edu-school">${t(edu.school)}</div>
            </div>
            <div class="edu-year">${t(edu.year)}</div>
          </div>
`)}        </div>
      </div>
      <div class="about-langs">
${site.languages.map((lang) => frag`        <span class="lang-chip">${t(lang.name)} <em>${t(lang.level)}</em></span>
`)}      </div>
      <div class="about-numbers">
${p.stats.map((stat) => frag`        <div>
          <div class="about-num-val">${t(stat.value)}${stat.suffix ? frag`<em>${t(stat.suffix)}</em>` : ''}</div>
          <div class="about-num-lbl">${t(stat.label)}</div>
        </div>
`)}      </div>
    </div>

  </div>
</section>
`;
}

function expertise(site, ctx) {
  const t = (text) => plainText(text, ctx);
  return frag`<!-- ══ EXPERTISE ═════════════════════════════════════════════ -->
<section class="expertise" id="expertise">
  <div class="wrap">
    <div class="reveal">
      <div class="eyebrow eyebrow-lt">What I Do</div>
      <h2 class="expertise-title">Engineering<br><span class="lime">Services</span></h2>
      <p class="expertise-intro">${t(site.services.intro)}</p>
    </div>
    <div class="expertise-grid">
${site.services.items.map((service, i) => frag`      <div class="exp-card reveal${['', ' d1', ' d2'][i % 3]}">
        <span class="exp-card-icon">${icon(service.icon)}</span>
        <div class="exp-card-head">
          <span class="exp-card-title">${t(service.title)}</span>
          ${icon('chevron', { class: 'exp-card-chev' })}
        </div>
        <div class="exp-card-desc">${t(service.description)}</div>
      </div>
`)}    </div>
  </div>
</section>
`;
}

function project(proj, ctx) {
  const t = (text) => plainText(text, ctx);
  const meta = [proj.period, proj.role].filter((part) => part !== '' && part != null).map((part) => separated(part, ctx).html).join(SEP);
  return frag`              <div class="proj-item">
                <div class="proj-name">${t(proj.name)}</div>
                <div class="proj-meta">${raw(meta)}</div>
${proj.scope ? frag`                <div class="proj-scope">${separated(proj.scope, ctx)}</div>
` : ''}                <ul class="proj-bullets">
${proj.bullets.map((bullet) => frag`                  <li>${t(bullet.text)}${filesSpan(bullet.files, ctx)}</li>
`)}                </ul>
              </div>
`;
}

function company(job, ctx) {
  const t = (text) => plainText(text, ctx);
  const projects = job.projects ?? [];
  return frag`
          <div class="tl-item${job.current ? ' now' : ''}">
            <div class="tl-period">${t(job.period)}</div>
            <div class="tl-company">${t(job.name)}</div>
            <div class="tl-role">${separated(job.role, ctx)}</div>
            <div class="tl-loc">${t(job.location)}</div>
            <div class="tl-summary">${t(job.summary)}</div>
${projects.length > 0 && frag`            <button class="tl-expand" onclick="toggleExp(this)" aria-expanded="false">
              <span>${t(job.expandLabel)}</span>
              ${icon('chevron', { width: '11', height: '11', 'stroke-width': '2.5' })}
            </button>
            <div class="tl-projects">
${projects.map((p) => project(p, ctx))}            </div>
`}          </div>
`;
}

function experience(site, ctx) {
  return frag`<!-- ══ EXPERIENCE ════════════════════════════════════════════ -->
<section class="experience" id="experience">
  <div class="wrap">

      <div class="experience-layout">

      <div class="exp-sidebar exp-header reveal">
        <div class="eyebrow">Career</div>
        <h2 class="exp-sidebar-title">Professional<br>Journey</h2>
        <p class="exp-sidebar-sub">${plainText(site.experience.intro, ctx)}</p>
        <a class="btn-lime" href="cv.html" target="_blank" rel="noopener" onclick="${downloadCvOnclick(site)}">
          ${icon('download', { width: '13', height: '13' })}
          Download CV
        </a>
      </div>

      <div class="reveal d1">
        <div class="timeline">
${site.experience.companies.map((c) => company(c, ctx))}
        </div><!-- /.timeline -->

      </div>

      </div><!-- /.experience-layout -->

  </div>
</section>
`;
}

function skills(site, ctx) {
  const t = (text) => plainText(text, ctx);
  return frag`<!-- ══ SKILLS ════════════════════════════════════════════════ -->
<section class="skills" id="skills">
  <div class="wrap">
    <div class="reveal">
      <div class="eyebrow eyebrow-lt">Technical Toolkit</div>
      <h2 class="skills-title">Skills &amp;<br><span style="color:var(--lime)">Software</span></h2>
    </div>
    <div class="skills-grid">
${site.skills.map((skill, i) => frag`      <div class="skill-cat reveal${i % 2 ? ' d1' : ''}">
        <div class="skill-cat-name">${t(skill.category)}</div>
        <div class="tags">
          ${sortedTags(skill.tags).map((tag) => frag`<span class="tag-lt${tag.level === 'expert' ? ' hi' : ''}">${t(tag.name)}</span>`)}
        </div>
      </div>
`)}    </div>
  </div>
</section>
`;
}

function cta(site, ctx) {
  const p = site.profile;
  const t = (text) => plainText(text, ctx);
  return frag`<!-- ══ CTA ═══════════════════════════════════════════════════ -->
<section class="cta" id="contact">
  <div class="wrap">
    <div class="cta-inner reveal">
      <div class="eyebrow" style="justify-content:center;">Get in Touch</div>
      <h2 class="cta-heading">${heading(site.cta.heading, ctx)}</h2>
      <p class="cta-sub">${t(site.cta.sub)}</p>
      <div class="cta-contact-row">
        <a class="cta-contact-item" href="tel:${p.phone.e164}">
          ${icon('phone', { width: '13', height: '13' })}
          ${t(p.phone.display)}
        </a>
        <a class="cta-contact-item" href="https://wa.me/${p.whatsapp}" target="_blank" rel="noopener">
          ${icon('whatsapp', { width: '13', height: '13' })}
          WhatsApp
        </a>
        <a class="cta-contact-item" href="mailto:${p.email}">
          ${icon('mail', { width: '13', height: '13' })}
          ${t(p.email)}
        </a>
        <a class="cta-contact-item" href="${p.linkedin}" target="_blank" rel="noopener">
          ${icon('linkedin')}
          LinkedIn
        </a>
      </div>
      <div class="cta-btns">
        <a class="btn-lime" href="contact.html">
          Start a Project
          ${icon('arrowRight')}
        </a>
        <a class="btn-outline" href="cv.html" target="_blank" rel="noopener" onclick="${downloadCvOnclick(site)}">
          ${icon('download', { width: '12', height: '12' })}
          Download CV
        </a>
      </div>
      <!-- Business Card -->
      ${businessCard(site, ctx)}
      <p class="cta-copyright">&copy; ${ctx.year} ${ctx.name}${raw(SEP)}${t(p.location.short)}</p>
    </div>
  </div>
</section>
`;
}

const PILL_NAV = `<!-- ══ FLOATING PILL NAV ══════════════════════════════════════ -->
<nav class="pill-nav" id="pill-nav" aria-label="Page sections">
  <a href="#home">Home</a>
  <a href="#about">About</a>
  <a href="#expertise">Expertise</a>
  <a href="#experience">Experience</a>
  <a href="#skills">Skills</a>
  <a href="#contact">Contact</a>
</nav>
`;

/** The whole home page. `ctx.unlocked` renders the download icons visible (dashboard preview). */
export function renderIndex(site, ctx) {
  const head = renderHead({
    site,
    ctx,
    page: 'index',
    title: fill(site.seo.titleIndex, ctx),
    description: fill(site.seo.descriptionIndex, ctx),
    ogDescription: fill(site.seo.ogDescriptionIndex, ctx),
    canonicalPath: '',
    ogType: 'profile',
    image: OG_IMAGE,
    jsonLd: indexJsonLd(site, ctx),
    styles: ['assets/css/main.css'],
  });
  return html`${raw(head)}<body>

${hero(site, ctx)}

${about(site, ctx)}
${expertise(site, ctx)}
${experience(site, ctx)}
${skills(site, ctx)}
${cta(site, ctx)}
${raw(PILL_NAV)}
<script src="${ctx.v('assets/js/main.js')}"></script>
<script type="module" src="${ctx.v('assets/js/access.mjs')}"></script>
</body>
</html>
`;
}
