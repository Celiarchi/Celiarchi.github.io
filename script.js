const topbar = document.querySelector('.topbar');
const menuToggle = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.navigation');
const page = document.body.dataset.page;
document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="dynamic.css"><link rel="icon" href="favicon.svg" type="image/svg+xml"><link rel="manifest" href="site.webmanifest"><meta name="theme-color" content="#7f2c35">');

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[character]);
const getJson = async (path) => { const response = await fetch(path); if (!response.ok) throw new Error('Contenu indisponible'); return response.json(); };

addEventListener('scroll', () => topbar?.classList.toggle('is-scrolled', scrollY > 30), { passive: true });
menuToggle?.addEventListener('click', () => { const isOpen = navigation.classList.toggle('is-open'); menuToggle.setAttribute('aria-expanded', String(isOpen)); menuToggle.lastChild.textContent = isOpen ? ' −' : ' +'; });
navigation?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => { navigation.classList.remove('is-open'); menuToggle?.setAttribute('aria-expanded', 'false'); if (menuToggle) menuToggle.lastChild.textContent = ' +'; }));

function applySiteContent(site) {
  if (site.name) document.title = document.title.replace(/Célia|Celiarchi/g, site.name);
  document.querySelectorAll('[data-site]').forEach((element) => { const value = site[element.dataset.site]; if (value !== undefined) { element.textContent = value; element.hidden = value === ''; } });
  document.querySelectorAll('[data-site-image]').forEach((element) => { const value = site[element.dataset.siteImage]; if (value) element.src = encodeURI(value); });
  document.querySelectorAll('[data-site-href]').forEach((element) => { const value = site[element.dataset.siteHref]; if (element.dataset.siteHref === 'email') { if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '')) element.href = `mailto:${value}`; else { element.removeAttribute('href'); element.hidden = true; } } });
}

function categoryLabel(category) { return category === 'public' ? 'Public' : 'Privé'; }
function projectCard(project) {
  const image = project.cover ? `<img src="${encodeURI(project.cover)}" alt="${escapeHtml(project.title)}" loading="lazy" decoding="async" />` : '<span class="project-image__empty">Image à ajouter</span>';
  const cutout = project.coverKind === 'cutout' ? ' project-card--cutout' : '';
  return `<a class="project-card project-card--${escapeHtml(project.layout || 'wide')}${cutout}" data-category="${escapeHtml(project.category)}" href="project.html?slug=${encodeURIComponent(project.slug)}"><div class="project-image">${image}</div><div class="project-meta"><span>${categoryLabel(project.category)}</span><span>${escapeHtml(project.description)}</span><span class="project-arrow">↗</span></div><h2>${escapeHtml(project.title)}</h2></a>`;
}
function renderProjects(projects) {
  const grid = document.querySelector('#projects-grid'); if (!grid) return;
  grid.innerHTML = projects.map(projectCard).join('');
  document.querySelectorAll('.filter').forEach((filter) => filter.addEventListener('click', () => { document.querySelectorAll('.filter').forEach((button) => button.classList.toggle('is-active', button === filter)); document.querySelectorAll('.project-card').forEach((card) => card.classList.toggle('is-hidden', filter.dataset.filter !== 'all' && card.dataset.category !== filter.dataset.filter)); }));
}
function renderProjectPage(project) {
  const content = document.querySelector('#project-page-content'); if (!content) return;
  if (!project) { content.innerHTML = '<section class="project-copy"><p class="eyebrow">Projet introuvable</p><div><p class="lead">Ce projet n’existe pas encore.</p><p><a href="projets.html">Retour aux projets</a></p></div></section>'; return; }
  content.className = `project-layout project-layout--${project.layout || 'wide'}`;
  document.title = `${project.title} — May’in`;
  const hero = project.cover ? `<img class="project-hero__image${project.coverKind === 'cutout' ? ' project-hero__image--cutout' : ''}" src="${encodeURI(project.cover)}" alt="${escapeHtml(project.title)}" fetchpriority="high" />` : '<div class="project-hero__empty">Image à ajouter</div>';
  const media = (project.media || []).map((item, index) => {
    const placement = ['left', 'right', 'center'][index % 3];
    return `<figure class="project-media project-media--${escapeHtml(item.kind || 'wide')} project-media--${placement} project-media--${escapeHtml(item.format || 'landscape')}"><img src="${encodeURI(item.src)}" alt="${escapeHtml(item.alt || `Vue du projet ${project.title}`)}" loading="lazy" decoding="async" /><figcaption>${escapeHtml(item.caption || '')}</figcaption></figure>`;
  }).join('');
  content.innerHTML = `<section class="project-hero"><a class="project-back" href="projets.html">← Tous les projets</a><p class="eyebrow">Projet ${categoryLabel(project.category)}</p><h1>${escapeHtml(project.title)}</h1>${hero}</section><section class="project-copy"><p class="eyebrow">En bref</p><div><p class="lead">${escapeHtml(project.description)}</p></div></section><section class="project-gallery">${media}<a href="projets.html" class="large-link">Tous les projets <span>↗</span></a></section>`;
}

Promise.all([getJson('content/site.json'), getJson('content/projects.json')]).then(([site, projectData]) => { applySiteContent(site); if (page === 'projects') renderProjects(projectData.projects); if (page === 'project') renderProjectPage(projectData.projects.find((project) => project.slug === new URLSearchParams(location.search).get('slug'))); }).catch(() => { const target = document.querySelector('#projects-grid, #project-page-content'); if (target) target.innerHTML = '<p class="content-error">Le contenu est temporairement indisponible.</p>'; });
