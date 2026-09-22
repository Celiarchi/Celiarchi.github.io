const topbar = document.querySelector('.topbar');
const menuToggle = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.navigation');
const page = document.body.dataset.page;
const previewParams = new URLSearchParams(location.search);
const isAdminPreview = previewParams.get('admin-preview') === '1' && window.parent !== window;
let previewEditMode = true;
let runtime = { site: null, projects: [] };

document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="dynamic.css"><link rel="icon" href="favicon.svg" type="image/svg+xml"><link rel="manifest" href="site.webmanifest">');

const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[character]);
const getJson = async (path) => { const response = await fetch(path, { cache: 'no-store' }); if (!response.ok) throw new Error('Contenu indisponible'); return response.json(); };
const assetSrc = (value = '') => String(value).startsWith('data:') || String(value).startsWith('blob:') ? value : encodeURI(value);
const safeToken = (value, fallback) => /^[a-z0-9-]+$/i.test(String(value || '')) ? String(value) : fallback;

addEventListener('scroll', () => topbar?.classList.toggle('is-scrolled', scrollY > 30), { passive: true });
menuToggle?.addEventListener('click', () => { const isOpen = navigation.classList.toggle('is-open'); menuToggle.setAttribute('aria-expanded', String(isOpen)); menuToggle.lastChild.textContent = isOpen ? ' −' : ' +'; });
navigation?.addEventListener('click', (event) => { if (!event.target.closest('a')) return; navigation.classList.remove('is-open'); menuToggle?.setAttribute('aria-expanded', 'false'); if (menuToggle) menuToggle.lastChild.textContent = ' +'; });

function normaliseSite(site) {
  const defaults = {
    menuLabel: 'Menu', filterAllLabel: 'Tous', filterPrivateLabel: 'Privé', filterPublicLabel: 'Public',
    privateLabel: 'Privé', publicLabel: 'Public', projectBackLabel: 'Tous les projets', projectTypeLabel: 'Projet',
    projectSummaryLabel: 'En bref', projectAllLabel: 'Tous les projets', aboutContactEyebrow: 'Parlons de votre projet',
    aboutContactLabel: 'Me contacter', copyright: `© ${new Date().getFullYear()}`, notFoundEyebrow: '404 · May’in',
    notFoundTitle: 'Cette page n’existe pas.', notFoundLinkLabel: 'Retour à l’accueil'
  };
  Object.entries(defaults).forEach(([key, value]) => { if (site[key] === undefined) site[key] = value; });
  site.navigation ||= [
    { label: 'Accueil', href: 'index.html', visible: true },
    { label: 'Projets', href: 'projets.html', visible: true },
    { label: 'Galerie', href: 'galerie.html', visible: true },
    { label: 'À propos', href: 'a-propos.html', visible: true },
    { label: 'Contact', href: 'contact.html', visible: true }
  ];
  site.socialLinks ||= [];
  site.gallery ||= { categories: [], items: [] };
  site.gallery.categories ||= [];
  site.gallery.items ||= [];
  site.customBlocks ||= {};
  ['home', 'projects', 'gallery', 'about', 'contact', 'notFound'].forEach((key) => { site.customBlocks[key] ||= []; });
  return site;
}

function applyDesign(site) {
  const design = site.design || {};
  const palette = (design.palettes || []).find((item) => item.id === design.activePalette) || design.palettes?.[0];
  const typography = (design.typographies || []).find((item) => item.id === design.activeTypography) || design.typographies?.[0];
  const root = document.documentElement.style;
  if (palette) {
    root.setProperty('--ink', palette.ink);
    root.setProperty('--wine', palette.accent);
    root.setProperty('--paper', palette.paper);
    root.setProperty('--muted', palette.muted);
    root.setProperty('--soft', palette.soft || palette.paper);
    root.setProperty('--line', `${palette.ink}2e`);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.accent);
  }
  if (typography) {
    root.setProperty('--serif', `"${typography.serif}", Georgia, serif`);
    root.setProperty('--sans', `"${typography.sans}", Arial, sans-serif`);
    root.setProperty('--mono', `"${typography.mono}", monospace`);
  }
}

function renderNavigation(site) {
  if (!navigation) return;
  const current = location.pathname.split('/').pop() || 'index.html';
  navigation.innerHTML = site.navigation.filter((item) => item.visible !== false).map((item, index) => {
    const active = item.href.split('?')[0] === current || (current === '' && item.href === 'index.html');
    return `<a ${active ? 'aria-current="page"' : ''} href="${escapeHtml(item.href)}" data-edit-path="site.navigation.${index}" data-edit-label="Lien de navigation">${escapeHtml(item.label)}</a>`;
  }).join('');
}

function applySiteFields(site) {
  if (site.name) document.title = document.title.replace(/Célia|Celiarchi|May’in/g, site.name);
  if (site.seoTitle && page === 'home') document.title = site.seoTitle;
  if (site.seoDescription) document.querySelector('meta[name="description"]')?.setAttribute('content', site.seoDescription);
  if (site.domain) {
    const pagePath = location.pathname.split('/').pop() || '';
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', `${site.domain.replace(/\/$/, '')}/${pagePath}`);
    document.querySelector('meta[property="og:url"]')?.setAttribute('content', `${site.domain.replace(/\/$/, '')}/${pagePath}`);
  }
  if (site.socialImage) {
    const socialUrl = `${site.domain.replace(/\/$/, '')}/${site.socialImage.replace(/^\//, '')}`;
    document.querySelector('meta[property="og:image"]')?.setAttribute('content', socialUrl);
    document.querySelector('meta[name="twitter:image"]')?.setAttribute('content', socialUrl);
  }
  document.querySelectorAll('[data-site]').forEach((element) => {
    const key = element.dataset.site;
    const value = site[key];
    if (value === undefined) return;
    element.textContent = value;
    element.hidden = value === '' && key !== 'email';
    element.dataset.editPath = `site.${key}`;
    element.dataset.editLabel = key;
    element.dataset.editInline = 'true';
  });
  document.querySelectorAll('[data-site-image]').forEach((element) => {
    const key = element.dataset.siteImage;
    const value = site[key];
    if (value) element.src = assetSrc(value);
    element.dataset.editPath = `site.${key}`;
    element.dataset.editLabel = 'Image';
  });
  document.querySelectorAll('[data-site-href]').forEach((element) => {
    const key = element.dataset.siteHref;
    const value = site[key];
    if (key === 'email') {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '')) { element.href = `mailto:${value}`; element.hidden = false; }
      else { element.removeAttribute('href'); element.hidden = !isAdminPreview; }
    }
  });
}

function renderSocialLinks(site) {
  const links = (site.socialLinks || []).filter((item) => item.visible !== false && item.label);
  document.querySelectorAll('[data-social-links]').forEach((container) => {
    container.innerHTML = links.map((item, index) => `<a href="${escapeHtml(item.url || '#')}" ${item.url?.startsWith('http') ? 'target="_blank" rel="noreferrer"' : ''} data-edit-path="site.socialLinks.${index}" data-edit-label="Lien social">${escapeHtml(item.label)}</a>`).join('<span aria-hidden="true"> · </span>');
    container.hidden = links.length === 0;
  });
}

function radiusClass(value) { return `radius-${safeToken(value, 'soft')}`; }
function imageStyle(item = {}) {
  const width = Math.max(25, Math.min(100, Number(item.width) || 100));
  const position = safeToken(item.objectPosition, 'center');
  return `--media-width:${width}%;--media-position:${position.replace('-', ' ')}`;
}
function categoryLabel(category) { return category === 'public' ? runtime.site.publicLabel : runtime.site.privateLabel; }

function projectCard(project, index) {
  const image = project.cover ? `<img src="${assetSrc(project.cover)}" alt="${escapeHtml(project.title)}" loading="lazy" decoding="async" />` : '<span class="project-image__empty">Image à ajouter</span>';
  const cutout = project.coverKind === 'cutout' ? ' project-card--cutout' : '';
  const radius = radiusClass(project.coverRadius || 'soft');
  return `<a class="project-card project-card--${safeToken(project.layout, 'wide')}${cutout} ${radius}" data-category="${escapeHtml(project.category)}" data-edit-path="projects.${index}" data-edit-label="Projet" href="project.html?slug=${encodeURIComponent(project.slug)}"><div class="project-image" style="${imageStyle(project)}">${image}</div><div class="project-meta"><span>${categoryLabel(project.category)}</span><span>${escapeHtml(project.description)}</span><span class="project-arrow">↗</span></div><h2 data-edit-path="projects.${index}.title" data-edit-label="Titre du projet" data-edit-inline="true">${escapeHtml(project.title)}</h2></a>`;
}

function renderProjects(projects) {
  const grid = document.querySelector('#projects-grid'); if (!grid) return;
  grid.innerHTML = projects.filter((project) => project.hidden !== true).map((project) => projectCard(project, projects.indexOf(project))).join('');
  document.querySelectorAll('.filter').forEach((filter) => filter.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((button) => button.classList.toggle('is-active', button === filter));
    document.querySelectorAll('.project-card').forEach((card) => card.classList.toggle('is-hidden', filter.dataset.filter !== 'all' && card.dataset.category !== filter.dataset.filter));
  }));
}

function renderProjectPage(projects) {
  const content = document.querySelector('#project-page-content'); if (!content) return;
  const slug = new URLSearchParams(location.search).get('slug');
  const projectIndex = projects.findIndex((item) => item.slug === slug);
  const project = projects[projectIndex];
  if (!project) { content.innerHTML = '<section class="project-copy"><p class="eyebrow">Projet introuvable</p><div><p class="lead">Ce projet n’existe pas encore.</p><p><a href="projets.html">Retour aux projets</a></p></div></section>'; return; }
  content.className = `project-layout project-layout--${safeToken(project.layout, 'wide')}`;
  document.title = `${project.title} — May’in`;
  const heroRadius = radiusClass(project.coverRadius || 'soft');
  const hero = project.cover ? `<img class="project-hero__image${project.coverKind === 'cutout' ? ' project-hero__image--cutout' : ''} ${heroRadius}" style="${imageStyle(project)}" src="${assetSrc(project.cover)}" alt="${escapeHtml(project.title)}" fetchpriority="high" data-edit-path="projects.${projectIndex}.cover" data-edit-label="Image de couverture" />` : '<div class="project-hero__empty">Image à ajouter</div>';
  const media = (project.media || []).map((item, mediaIndex) => {
    const placement = item.align || ['left', 'right', 'center'][mediaIndex % 3];
    const radius = radiusClass(item.radius || (item.kind === 'cutout' || item.kind === 'plan' ? 'none' : 'soft'));
    return `<figure class="project-media project-media--${safeToken(item.kind, 'wide')} project-media--${safeToken(placement, 'center')} project-media--${safeToken(item.format, 'landscape')} ${radius}" style="${imageStyle(item)}" data-edit-path="projects.${projectIndex}.media.${mediaIndex}" data-edit-label="Image du projet"><img src="${assetSrc(item.src)}" alt="${escapeHtml(item.alt || `Vue du projet ${project.title}`)}" loading="lazy" decoding="async" /><figcaption data-edit-path="projects.${projectIndex}.media.${mediaIndex}.caption" data-edit-label="Légende" data-edit-inline="true">${escapeHtml(item.caption || '')}</figcaption></figure>`;
  }).join('');
  const blocks = renderBlocks(project.blocks || [], `projects.${projectIndex}.blocks`);
  content.innerHTML = `<section class="project-hero"><a class="project-back" href="projets.html">← <span data-edit-path="site.projectBackLabel" data-edit-label="Retour aux projets" data-edit-inline="true">${escapeHtml(runtime.site.projectBackLabel)}</span></a><p class="eyebrow"><span data-edit-path="site.projectTypeLabel" data-edit-label="Libellé du projet" data-edit-inline="true">${escapeHtml(runtime.site.projectTypeLabel)}</span> <span data-edit-path="site.${project.category === 'public' ? 'publicLabel' : 'privateLabel'}" data-edit-label="Catégorie" data-edit-inline="true">${escapeHtml(categoryLabel(project.category))}</span></p><h1 data-edit-path="projects.${projectIndex}.title" data-edit-label="Titre du projet" data-edit-inline="true">${escapeHtml(project.title)}</h1>${hero}</section><section class="project-copy"><p class="eyebrow" data-edit-path="site.projectSummaryLabel" data-edit-label="Titre du résumé" data-edit-inline="true">${escapeHtml(runtime.site.projectSummaryLabel)}</p><div><p class="lead" data-edit-path="projects.${projectIndex}.description" data-edit-label="Description" data-edit-inline="true">${escapeHtml(project.description)}</p></div></section>${blocks}<section class="project-gallery">${media}<a href="projets.html" class="large-link"><span data-edit-path="site.projectAllLabel" data-edit-label="Lien vers les projets" data-edit-inline="true">${escapeHtml(runtime.site.projectAllLabel)}</span> <span>↗</span></a></section>`;
}

function renderGallery(site) {
  const grid = document.querySelector('#gallery-grid'); if (!grid) return;
  const items = site.gallery?.items || [];
  document.querySelector('.gallery-empty')?.classList.toggle('gallery-empty--with-items', items.length > 0);
  grid.innerHTML = items.map((item, index) => `<figure class="gallery-item gallery-item--${safeToken(item.size, 'medium')} ${radiusClass(item.radius || 'soft')}" data-edit-path="site.gallery.items.${index}" data-edit-label="Image de galerie" style="${imageStyle(item)}"><img src="${assetSrc(item.src)}" alt="${escapeHtml(item.alt || item.caption || '')}" loading="lazy" /><figcaption><span>${escapeHtml(item.category || '')}</span><span data-edit-path="site.gallery.items.${index}.caption" data-edit-label="Légende" data-edit-inline="true">${escapeHtml(item.caption || '')}</span>${item.credit ? `<small>${escapeHtml(item.credit)}</small>` : ''}</figcaption></figure>`).join('');
}

function renderBlocks(blocks, basePath) {
  if (!blocks?.length) return '';
  return `<section class="custom-blocks">${blocks.filter((block) => block.hidden !== true).map((block, index) => {
    const path = `${basePath}.${index}`;
    if (block.type === 'image') return `<figure class="custom-block custom-block--image ${radiusClass(block.radius || 'soft')}" style="${imageStyle(block)}" data-edit-path="${path}" data-edit-label="Bloc image"><img src="${assetSrc(block.src)}" alt="${escapeHtml(block.alt || block.caption || '')}" /><figcaption data-edit-path="${path}.caption" data-edit-label="Légende" data-edit-inline="true">${escapeHtml(block.caption || '')}</figcaption></figure>`;
    if (block.type === 'quote') return `<blockquote class="custom-block custom-block--quote" data-edit-path="${path}" data-edit-label="Citation"><p data-edit-path="${path}.text" data-edit-inline="true">${escapeHtml(block.text || 'Citation')}</p></blockquote>`;
    if (block.type === 'divider') return `<hr class="custom-block custom-block--divider" data-edit-path="${path}" data-edit-label="Séparateur" />`;
    if (block.type === 'spacer') return `<div class="custom-block custom-block--spacer" style="--space:${Math.max(20, Math.min(240, Number(block.height) || 80))}px" data-edit-path="${path}" data-edit-label="Espacement"></div>`;
    return `<div class="custom-block custom-block--text custom-block--${safeToken(block.style, 'body')}" data-edit-path="${path}" data-edit-label="Bloc texte"><p data-edit-path="${path}.text" data-edit-inline="true">${escapeHtml(block.text || 'Nouveau texte')}</p></div>`;
  }).join('')}</section>`;
}

function renderCustomBlocks(site) {
  document.querySelectorAll('[data-custom-blocks]').forEach((container) => {
    const key = container.dataset.customBlocks;
    container.innerHTML = renderBlocks(site.customBlocks?.[key] || [], `site.customBlocks.${key}`);
  });
}

function renderAll(site, projects) {
  runtime = { site: normaliseSite(structuredClone(site)), projects: structuredClone(projects || []) };
  applyDesign(runtime.site);
  renderNavigation(runtime.site);
  applySiteFields(runtime.site);
  renderSocialLinks(runtime.site);
  if (page === 'projects') renderProjects(runtime.projects);
  if (page === 'project') renderProjectPage(runtime.projects);
  if (page === 'gallery') renderGallery(runtime.site);
  renderCustomBlocks(runtime.site);
  prepareAdminPreview();
}

function prepareAdminPreview() {
  if (!isAdminPreview) return;
  document.body.classList.add('admin-preview');
  document.body.classList.toggle('admin-preview--edit', previewEditMode);
  document.querySelectorAll('[data-edit-inline]').forEach((element) => { element.contentEditable = previewEditMode ? 'plaintext-only' : 'false'; element.spellcheck = true; });
  const hero = document.querySelector('.home-hero');
  if (hero && !hero.querySelector('.admin-image-handle')) {
    hero.insertAdjacentHTML('beforeend', '<button class="admin-image-handle" type="button" data-edit-path="site.heroImage" data-edit-label="Image de fond">✎ Image de fond</button>');
  }
  window.parent.postMessage({ type: 'mayin:preview-ready', page, href: location.href }, location.origin);
}

if (isAdminPreview) {
  document.addEventListener('click', (event) => {
    if (!previewEditMode) return;
    const editable = event.target.closest('[data-edit-path]');
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    document.querySelectorAll('.admin-selected').forEach((item) => item.classList.remove('admin-selected'));
    editable.classList.add('admin-selected');
    window.parent.postMessage({ type: 'mayin:select', path: editable.dataset.editPath, label: editable.dataset.editLabel || 'Élément' }, location.origin);
  }, true);
  document.addEventListener('input', (event) => {
    const editable = event.target.closest('[data-edit-inline]');
    if (!editable || !previewEditMode) return;
    window.parent.postMessage({ type: 'mayin:inline', path: editable.dataset.editPath, value: editable.textContent }, location.origin);
  });
  addEventListener('message', (event) => {
    if (event.origin !== location.origin || !event.data) return;
    if (event.data.type === 'mayin:data') renderAll(event.data.site, event.data.projects);
    if (event.data.type === 'mayin:mode') { previewEditMode = event.data.mode === 'edit'; prepareAdminPreview(); }
  });
}

Promise.all([getJson('content/site.json'), getJson('content/projects.json')])
  .then(([site, projectData]) => renderAll(site, projectData.projects))
  .catch(() => { const target = document.querySelector('#projects-grid, #project-page-content'); if (target) target.innerHTML = '<p class="content-error">Le contenu est temporairement indisponible.</p>'; });
