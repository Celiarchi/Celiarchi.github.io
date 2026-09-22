const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const dom = {
  boot: $('#boot'), login: $('#login'), studio: $('#studio'), loginButton: $('#login-button'),
  frame: $('#preview'), shell: $('#preview-shell'), inspector: $('#inspector'), inspectorTitle: $('#inspector-title'),
  pageList: $('#page-list'), projectList: $('#project-list'), publish: $('#publish'), undo: $('#undo'), redo: $('#redo'),
  saveState: $('#save-state'), toast: $('#toast'), imageInput: $('#image-input'), previewPublic: $('#preview-public'),
  leftSidebar: $('.sidebar--left'), rightSidebar: $('.sidebar--right'), mobileContent: $('#mobile-content'), mobileProperties: $('#mobile-properties')
};
const pageDefinitions = [
  { id: 'home', label: 'Accueil', icon: '⌂', href: '../index.html?admin-preview=1' },
  { id: 'projects', label: 'Projets', icon: '◫', href: '../projets.html?admin-preview=1' },
  { id: 'gallery', label: 'Galerie', icon: '▦', href: '../galerie.html?admin-preview=1' },
  { id: 'about', label: 'À propos', icon: '○', href: '../a-propos.html?admin-preview=1' },
  { id: 'contact', label: 'Contact', icon: '↗', href: '../contact.html?admin-preview=1' },
  { id: 'notFound', label: 'Page 404', icon: '!', href: '../404.html?admin-preview=1' }
];
const localMode = ['localhost', '127.0.0.1'].includes(location.hostname);
const clone = (value) => structuredClone(value);
const encode = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' })[character]);
let apiBase = '';
let csrf = '';
let sessionToken = sessionStorage.getItem('mayin-session') || '';
let currentUser = null;
let data = { site: null, projects: [] };
let undoStack = [];
let redoStack = [];
let selectedPath = '';
let activePanel = '';
let activePage = 'home';
let uploadTarget = null;
let uploadCounter = 0;
let inlineSessionPath = '';
let previewMode = 'edit';
let saveTimer = 0;
let toastTimer = 0;
const siteImagePaths = new Set(['site.heroImage', 'site.socialImage']);

function pathParts(path) { return path.split('.').filter(Boolean).map((part) => /^\d+$/.test(part) ? Number(part) : part); }
function getPath(path) { return pathParts(path).reduce((value, part) => value?.[part], data); }
function setPath(path, value) { const parts = pathParts(path); const last = parts.pop(); const parent = parts.reduce((item, part) => item[part], data); parent[last] = value; }
function deletePath(path) { const parts = pathParts(path); const last = parts.pop(); const parent = parts.reduce((item, part) => item[part], data); Array.isArray(parent) ? parent.splice(last, 1) : delete parent[last]; }
function slugify(value) { return String(value || 'element').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'element'; }
function moveItem(path, delta) { const parts = pathParts(path); const index = parts.pop(); const list = parts.reduce((item, part) => item[part], data); const next = index + Number(delta); if (!Array.isArray(list) || next < 0 || next >= list.length) return; pushHistory(); [list[index], list[next]] = [list[next], list[index]]; selectedPath = `${parts.join('.')}.${next}`; markChanged(); }

function showToast(message, error = false) {
  clearTimeout(toastTimer); dom.toast.textContent = message; dom.toast.className = `toast is-visible${error ? ' is-error' : ''}`;
  toastTimer = setTimeout(() => dom.toast.className = 'toast', 3200);
}
function setSaveState(message) { dom.saveState.textContent = message; }
function authHeaders(extra = {}) { return sessionToken ? { ...extra, Authorization:`Bearer ${sessionToken}` } : extra; }
function pushHistory() {
  undoStack.push(JSON.stringify(data)); if (undoStack.length > 40) undoStack.shift(); redoStack = []; updateHistoryButtons();
}
function updateHistoryButtons() { dom.undo.disabled = undoStack.length === 0; dom.redo.disabled = redoStack.length === 0; }
function markChanged(refreshInspector = true) {
  clearTimeout(saveTimer); setSaveState('Modifications…');
  saveTimer = setTimeout(() => { localStorage.setItem('mayin-studio-draft', JSON.stringify(data)); setSaveState('Brouillon local'); }, 500);
  sendDraft(); renderProjectList(); if (refreshInspector) renderInspector();
}
function mutate(path, value, refresh = true) { pushHistory(); setPath(path, value); markChanged(refresh); }
function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(data)); data = JSON.parse(undoStack.pop()); updateHistoryButtons(); renderAllAdmin(); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(data)); data = JSON.parse(redoStack.pop()); updateHistoryButtons(); renderAllAdmin(); }

function sendDraft() {
  dom.frame.contentWindow?.postMessage({ type: 'mayin:data', site: data.site, projects: data.projects }, location.origin);
}
function setPreviewMode(mode) {
  previewMode = mode;
  $$('.segmented').forEach((button) => button.classList.toggle('is-active', button.dataset.mode === mode));
  dom.frame.contentWindow?.postMessage({ type: 'mayin:mode', mode }, location.origin);
  $('#workspace-hint').textContent = mode === 'edit' ? 'Clique sur un élément du site pour le modifier' : 'Navigation active — utilise les liens normalement';
}
function wirePreviewDocument() {
  const previewDocument = dom.frame.contentDocument;
  if (!previewDocument || previewDocument.documentElement.dataset.studioWired === 'true') return;
  previewDocument.documentElement.dataset.studioWired = 'true';
  previewDocument.addEventListener('click', (event) => {
    if (previewMode !== 'edit') return;
    const editable = event.target.closest?.('[data-edit-path]'); if (!editable) return;
    event.preventDefault(); event.stopPropagation();
    previewDocument.querySelectorAll('.admin-selected').forEach((item) => item.classList.remove('admin-selected'));
    editable.classList.add('admin-selected'); selectedPath = editable.dataset.editPath; activePanel = ''; renderProjectList(); renderInspector(); revealInspector();
  }, true);
  previewDocument.addEventListener('input', (event) => {
    if (previewMode !== 'edit') return;
    const editable = event.target.closest?.('[data-edit-inline]'); if (!editable) return;
    if (inlineSessionPath !== editable.dataset.editPath) { pushHistory(); inlineSessionPath = editable.dataset.editPath; }
    setPath(editable.dataset.editPath, editable.textContent); markChanged(false);
  });
}
function navigatePreview(href, pageId) {
  activePage = pageId || activePage; dom.frame.src = href;
  $$('.page-button').forEach((button) => button.classList.toggle('is-active', button.dataset.page === activePage));
}
function isCompact() { return matchMedia('(max-width:760px)').matches; }
function openMobilePanel(panel = '') {
  dom.leftSidebar.classList.toggle('is-open', panel === 'content');
  dom.rightSidebar.classList.toggle('is-open', panel === 'properties');
}
function revealInspector() { if (isCompact()) openMobilePanel('properties'); }

function renderPageList() {
  dom.pageList.innerHTML = pageDefinitions.map((item) => `<button class="page-button${item.id === activePage ? ' is-active' : ''}" data-page="${item.id}" data-href="${item.href}"><span>${item.icon}</span><span>${item.label}</span></button>`).join('');
}
function renderProjectList() {
  dom.projectList.innerHTML = data.projects.map((project, index) => { const cover = project.cover?.startsWith('data:') ? project.cover : `../${project.cover || 'favicon.svg'}`; return `<div class="project-row${selectedPath.startsWith(`projects.${index}`) ? ' is-active' : ''}" data-project-index="${index}"><img src="${encode(cover)}" alt="" /><span>${encode(project.title)}</span><small>${project.category === 'public' ? 'PU' : 'PR'}</small></div>`; }).join('');
}
function renderAllAdmin() { renderPageList(); renderProjectList(); renderInspector(); sendDraft(); }

function field(label, path, type = 'text', options = {}) {
  const value = getPath(path) ?? '';
  if (type === 'textarea') return `<label class="field"><span>${label}</span><textarea data-path="${path}" rows="${options.rows || 4}">${encode(value)}</textarea></label>`;
  if (type === 'select') return `<label class="field"><span>${label}</span><select data-path="${path}">${options.choices.map(([key, text]) => `<option value="${key}" ${String(value) === key ? 'selected' : ''}>${text}</option>`).join('')}</select></label>`;
  if (type === 'checkbox') return `<label class="field field--check"><span><input type="checkbox" data-path="${path}" ${value ? 'checked' : ''} /> ${label}</span></label>`;
  if (type === 'range') return `<label class="field"><span>${label}</span><div class="range-row"><input type="range" min="${options.min || 25}" max="${options.max || 100}" step="${options.step || 5}" value="${Number(value) || options.defaultValue || 100}" data-path="${path}" /><output>${Number(value) || options.defaultValue || 100}%</output></div></label>`;
  return `<label class="field"><span>${label}</span><input type="${type}" data-path="${path}" value="${encode(value)}" ${options.placeholder ? `placeholder="${encode(options.placeholder)}"` : ''} /></label>`;
}
function imageControl(path, label = 'Image') {
  const value = getPath(path) || '';
  const source = value.startsWith('data:') ? value : `../${value}`;
  return `<div class="form-section"><h3>${label}</h3><div class="image-control">${value ? `<img src="${encode(source)}" alt="" />` : ''}<button class="button" data-upload-path="${path}">Remplacer</button></div>${field('Chemin de l’image', path)}</div>`;
}
function choices(label, path, values) {
  const current = getPath(path);
  return `<div class="form-section"><h3>${label}</h3><div class="choice-grid">${values.map(([value, text]) => `<button class="choice${current === value ? ' is-active' : ''}" data-choice-path="${path}" data-choice-value="${value}">${text}</button>`).join('')}</div></div>`;
}
function blockControls(basePath) {
  return `<div class="form-section"><h3>Ajouter un bloc</h3><div class="add-blocks"><button data-add-block="text" data-block-base="${basePath}">+ Texte</button><button data-add-block="lead" data-block-base="${basePath}">+ Grand texte</button><button data-add-block="quote" data-block-base="${basePath}">+ Citation</button><button data-add-block="image" data-block-base="${basePath}">+ Image</button><button data-add-block="divider" data-block-base="${basePath}">+ Ligne</button><button data-add-block="spacer" data-block-base="${basePath}">+ Espace</button></div></div>`;
}

function renderSiteField(path, label) {
  const value = getPath(path);
  dom.inspectorTitle.textContent = label || 'Texte';
  const type = typeof value === 'string' && value.length > 70 ? 'textarea' : 'text';
  dom.inspector.innerHTML = `<div class="form-section"><h3>Contenu</h3>${field(label || 'Texte', path, type)}</div>`;
}
function renderLinkItem(path) {
  const item = getPath(path); if (!item) return renderEmpty();
  const social = path.startsWith('site.socialLinks.');
  dom.inspectorTitle.textContent = social ? 'Lien externe' : 'Lien du menu';
  dom.inspector.innerHTML = `<div class="form-section"><h3>${social ? 'Réseau ou lien' : 'Navigation'}</h3>${field('Libellé', `${path}.label`)}${field('Adresse', `${path}.${social ? 'url' : 'href'}`)}${field('Afficher ce lien', `${path}.visible`, 'checkbox')}</div><button class="danger-button" data-remove-path="${path}">Supprimer ce lien</button>`;
}
function renderProject(index) {
  const project = data.projects[index]; if (!project) return renderEmpty();
  const base = `projects.${index}`; dom.inspectorTitle.textContent = project.title;
  dom.inspector.innerHTML = `${imageControl(`${base}.cover`, 'Couverture')}
    <div class="form-section"><h3>Projet</h3>${field('Titre', `${base}.title`)}${field('Adresse courte', `${base}.slug`)}${field('Description', `${base}.description`, 'textarea')}
    <div class="field-row">${field('Catégorie', `${base}.category`, 'select', { choices: [['prive','Privé'],['public','Public']] })}${field('Format de carte', `${base}.layout`, 'select', { choices: [['wide','Large'],['square','Carré'],['portrait','Portrait'],['tall','Vertical']] })}</div>
    ${field('Masquer ce projet', `${base}.hidden`, 'checkbox')}</div>
    ${choices('Présentation de la couverture', `${base}.coverKind`, [['photo','Photo'],['cutout','Détourée']])}
    ${choices('Coins de la couverture', `${base}.coverRadius`, [['none','Carrés'],['soft','Doux'],['top-right','Angle'],['diagonal','Diagonal'],['all','Arrondis'],['pill','Pilule']])}
    <div class="form-section"><h3>Dimensions et cadrage</h3>${field('Largeur', `${base}.width`, 'range')}${field('Position', `${base}.objectPosition`, 'select', { choices: [['center','Centre'],['top','Haut'],['bottom','Bas'],['left','Gauche'],['right','Droite']] })}</div>
    <div class="form-section"><h3>Images du projet (${project.media?.length || 0})</h3><div class="list-editor">${(project.media || []).map((item, mediaIndex) => `<button class="page-button" data-select-path="${base}.media.${mediaIndex}"><span>▧</span><span>${encode(item.caption || item.alt || `Image ${mediaIndex + 1}`)}</span></button>`).join('')}</div><button class="button" data-add-project-image="${index}">+ Ajouter une image</button></div>
    ${blockControls(`${base}.blocks`)}<div class="form-section"><h3>Organisation</h3><div class="field-row"><button class="button" data-move-path="projects.${index}" data-delta="-1">↑ Monter</button><button class="button" data-move-path="projects.${index}" data-delta="1">↓ Descendre</button></div><button class="button" data-duplicate-project="${index}">Dupliquer le projet</button></div><button class="danger-button" data-delete-project="${index}">Supprimer ce projet</button>`;
}
function renderMedia(projectIndex, mediaIndex) {
  const base = `projects.${projectIndex}.media.${mediaIndex}`; const item = getPath(base); if (!item) return renderProject(projectIndex);
  dom.inspectorTitle.textContent = `Image ${mediaIndex + 1}`;
  dom.inspector.innerHTML = `${imageControl(`${base}.src`)}<div class="form-section"><h3>Texte</h3>${field('Légende', `${base}.caption`, 'textarea', { rows: 3 })}${field('Description accessible', `${base}.alt`, 'textarea', { rows: 3 })}</div>
    ${choices('Taille', `${base}.kind`, [['wide','Large'],['process','Moyenne'],['detail','Petite'],['cutout','Détourée'],['plan','Plan']])}
    ${choices('Placement', `${base}.align`, [['left','Gauche'],['center','Centre'],['right','Droite']])}
    ${choices('Coins', `${base}.radius`, [['none','Carrés'],['soft','Doux'],['top-right','Angle'],['diagonal','Diagonal'],['all','Arrondis'],['pill','Pilule']])}
    <div class="form-section"><h3>Dimensions et cadrage</h3>${field('Largeur', `${base}.width`, 'range')}${field('Position', `${base}.objectPosition`, 'select', { choices: [['center','Centre'],['top','Haut'],['bottom','Bas'],['left','Gauche'],['right','Droite']] })}</div>
    <div class="form-section"><h3>Organisation</h3><div class="field-row"><button class="button" data-move-path="${base}" data-delta="-1">↑ Avant</button><button class="button" data-move-path="${base}" data-delta="1">↓ Après</button></div><button class="danger-button" data-remove-path="${base}">Retirer cette image</button></div>`;
}
function renderGalleryItem(index) {
  const base = `site.gallery.items.${index}`; dom.inspectorTitle.textContent = `Galerie · ${index + 1}`;
  dom.inspector.innerHTML = `${imageControl(`${base}.src`)}<div class="form-section"><h3>Informations</h3>${field('Catégorie', `${base}.category`)}${field('Légende', `${base}.caption`, 'textarea')}${field('Crédit / source', `${base}.credit`)}${field('Description accessible', `${base}.alt`, 'textarea')}</div>
    ${choices('Taille', `${base}.size`, [['small','Petite'],['medium','Moyenne'],['large','Grande']])}${choices('Coins', `${base}.radius`, [['none','Carrés'],['soft','Doux'],['top-right','Angle'],['diagonal','Diagonal'],['all','Arrondis'],['pill','Pilule']])}
    <div class="form-section">${field('Largeur', `${base}.width`, 'range')}${field('Position', `${base}.objectPosition`, 'select', { choices: [['center','Centre'],['top','Haut'],['bottom','Bas'],['left','Gauche'],['right','Droite']] })}<div class="field-row"><button class="button" data-move-path="${base}" data-delta="-1">↑ Avant</button><button class="button" data-move-path="${base}" data-delta="1">↓ Après</button></div><button class="danger-button" data-remove-path="${base}">Retirer de la galerie</button></div>`;
}
function renderBlock(path) {
  const block = getPath(path); if (!block) return renderEmpty(); dom.inspectorTitle.textContent = 'Bloc de contenu';
  let fields = '';
  if (block.type === 'image') fields = imageControl(`${path}.src`) + field('Légende', `${path}.caption`, 'textarea') + field('Description accessible', `${path}.alt`, 'textarea') + field('Largeur', `${path}.width`, 'range') + field('Position', `${path}.objectPosition`, 'select', { choices: [['center','Centre'],['top','Haut'],['bottom','Bas'],['left','Gauche'],['right','Droite']] }) + choices('Coins', `${path}.radius`, [['none','Carrés'],['soft','Doux'],['top-right','Angle'],['diagonal','Diagonal'],['all','Arrondis']]);
  else if (block.type === 'spacer') fields = field('Hauteur', `${path}.height`, 'range', { min:20,max:240,step:10,defaultValue:80 });
  else if (block.type !== 'divider') fields = field('Texte', `${path}.text`, 'textarea', { rows: 6 });
  dom.inspector.innerHTML = `<div class="form-section"><h3>${encode(block.type)}</h3>${fields}</div><div class="form-section"><div class="field-row"><button class="button" data-move-path="${path}" data-delta="-1">↑ Avant</button><button class="button" data-move-path="${path}" data-delta="1">↓ Après</button></div><button class="danger-button" data-remove-path="${path}">Supprimer ce bloc</button></div>`;
}
function renderDesign() {
  dom.inspectorTitle.textContent = 'Design & palettes'; const design = data.site.design;
  dom.inspector.innerHTML = `<div class="form-section"><h3>Palettes enregistrées</h3><div class="palette-list">${design.palettes.map((palette, index) => `<button class="palette-card${palette.id === design.activePalette ? ' is-active' : ''}" data-palette="${palette.id}"><strong>${encode(palette.name)}</strong><span class="swatches"><i style="background:${palette.ink}"></i><i style="background:${palette.accent}"></i><i style="background:${palette.paper}"></i></span></button>`).join('')}</div><button class="button" data-duplicate-palette>Dupliquer la palette active</button></div>
    <div class="form-section"><h3>Modifier la palette active</h3>${(() => { const i = design.palettes.findIndex(p => p.id === design.activePalette); const b = `site.design.palettes.${i}`; return `${field('Nom',`${b}.name`)}<div class="field-row">${field('Texte',`${b}.ink`,'color')}${field('Accent',`${b}.accent`,'color')}${field('Fond',`${b}.paper`,'color')}${field('Secondaire',`${b}.muted`,'color')}</div>`; })()}</div>
    <div class="form-section"><h3>Typographie</h3>${field('Combinaison', 'site.design.activeTypography', 'select', { choices: design.typographies.map(item => [item.id,item.name]) })}</div>`;
}
function renderNavigationPanel() {
  dom.inspectorTitle.textContent = 'Navigation & liens';
  dom.inspector.innerHTML = `<div class="form-section"><h3>Menu principal</h3><div class="list-editor">${data.site.navigation.map((item, index) => `<div class="list-row">${field('',`site.navigation.${index}.label`)}${field('',`site.navigation.${index}.href`)}<button data-remove-path="site.navigation.${index}">×</button></div>`).join('')}</div><button class="button" data-add-navigation>+ Lien de menu</button></div>
    <div class="form-section"><h3>Réseaux et liens externes</h3><div class="list-editor">${data.site.socialLinks.map((item, index) => `<div class="list-row">${field('',`site.socialLinks.${index}.label`)}${field('',`site.socialLinks.${index}.url`)}<button data-remove-path="site.socialLinks.${index}">×</button></div>`).join('')}</div><button class="button" data-add-social>+ Ajouter un lien</button></div>`;
}
function renderGalleryPanel() {
  dom.inspectorTitle.textContent = 'Galerie';
  dom.inspector.innerHTML = `<div class="form-section"><h3>Images (${data.site.gallery.items.length})</h3><div class="list-editor">${data.site.gallery.items.map((item,index) => `<button class="page-button" data-select-path="site.gallery.items.${index}"><span>▧</span><span>${encode(item.caption || `Image ${index+1}`)}</span></button>`).join('')}</div><button class="button" data-add-gallery-image>+ Ajouter une image</button></div><div class="form-section"><h3>Catégories</h3><div class="list-editor">${data.site.gallery.categories.map((item,index)=>`<div class="list-row">${field('',`site.gallery.categories.${index}`)}<span></span><button data-remove-path="site.gallery.categories.${index}">×</button></div>`).join('')}</div><button class="button" data-add-gallery-category>+ Catégorie</button></div>`;
}
function renderSettings() {
  dom.inspectorTitle.textContent = 'Réglages du site';
  dom.inspector.innerHTML = `<div class="form-section"><h3>Identité</h3>${field('Nom du site','site.name')}${field('Activités','site.role')}${field('Adresse du site','site.domain','url')}</div>${imageControl('site.socialImage','Image de partage')}<div class="form-section"><h3>Référencement</h3>${field('Titre pour les moteurs de recherche','site.seoTitle')}${field('Description','site.seoDescription','textarea')}</div><div class="form-section"><h3>Libellés globaux</h3>${field('Bouton du menu','site.menuLabel')}${field('Catégorie privée','site.privateLabel')}${field('Catégorie publique','site.publicLabel')}${field('Copyright','site.copyright')}</div><div class="form-section"><h3>Contact</h3>${field('E-mail','site.email','email')}${field('Téléphone','site.phone')}${field('Coordonnées affichées','site.contactDetails','textarea')}</div><div class="form-section"><h3>Sauvegarde</h3><button class="button" data-export>Télécharger une sauvegarde JSON</button></div>`;
}
function renderPagePanel(pageId) {
  const definition = pageDefinitions.find(item => item.id === pageId); dom.inspectorTitle.textContent = definition?.label || 'Page';
  const heading = pageId === 'notFound' ? 'Page 404' : `Page ${definition?.label || ''}`;
  dom.inspector.innerHTML = `<div class="form-section"><h3>${encode(heading)}</h3><p class="empty-state">Clique directement sur un texte ou une image dans la page pour le modifier.</p></div>${blockControls(`site.customBlocks.${pageId}`)}`;
}
function renderEmpty() { dom.inspectorTitle.textContent = 'Propriétés'; dom.inspector.innerHTML = '<div class="empty-state"><span>✦</span><p>Sélectionne un texte, une image ou un projet dans la prévisualisation.</p></div>'; }
function renderInspector() {
  if (activePanel === 'design') return renderDesign();
  if (activePanel === 'navigation') return renderNavigationPanel();
  if (activePanel === 'gallery') return renderGalleryPanel();
  if (activePanel === 'settings') return renderSettings();
  if (activePanel.startsWith('page:')) return renderPagePanel(activePanel.split(':')[1]);
  if (!selectedPath) return renderEmpty();
  const parts = pathParts(selectedPath);
  if (parts[0] === 'projects' && typeof parts[1] === 'number' && parts[2] === 'media') return renderMedia(parts[1], parts[3]);
  if (parts[0] === 'projects' && typeof parts[1] === 'number' && parts[2] === 'blocks') return renderBlock(selectedPath);
  if (parts[0] === 'projects' && typeof parts[1] === 'number') return parts.length > 3 || ['title','description','cover'].includes(parts[2]) ? renderProject(parts[1]) : renderProject(parts[1]);
  if (parts.slice(0,3).join('.') === 'site.gallery.items' && typeof parts[3] === 'number') return renderGalleryItem(parts[3]);
  if (parts.slice(0,2).join('.') === 'site.customBlocks') return renderBlock(parts.slice(0,4).join('.'));
  if (parts.slice(0,2).join('.') === 'site.navigation' && typeof parts[2] === 'number') return renderLinkItem(parts.slice(0,3).join('.'));
  if (parts.slice(0,2).join('.') === 'site.socialLinks' && typeof parts[2] === 'number') return renderLinkItem(parts.slice(0,3).join('.'));
  if (siteImagePaths.has(selectedPath)) { dom.inspectorTitle.textContent = selectedPath === 'site.heroImage' ? 'Image de fond' : 'Image de partage'; dom.inspector.innerHTML = imageControl(selectedPath); return; }
  renderSiteField(selectedPath, selectedPath.split('.').pop());
}

async function compressImage(file) {
  if (file.size > 30 * 1024 * 1024) throw new Error('Cette image dépasse 30 Mo.');
  const bitmap = await createImageBitmap(file); const max = 2400; const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d', { alpha: true }).drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  return canvas.toDataURL('image/webp', .84);
}
function startUpload(target) { uploadTarget = target; dom.imageInput.value = ''; dom.imageInput.click(); }
async function handleUpload(file) {
  if (!file || !uploadTarget) return;
  try {
    setSaveState('Optimisation image…'); const dataUrl = await compressImage(file); pushHistory();
    if (uploadTarget.type === 'path') setPath(uploadTarget.path, dataUrl);
    if (uploadTarget.type === 'project-media') { const media = data.projects[uploadTarget.index].media ||= []; media.push({ src:dataUrl, alt:'', caption:'', kind:'wide', format:'landscape', align:'center', radius:'soft', width:100 }); selectedPath = `projects.${uploadTarget.index}.media.${media.length-1}`; }
    if (uploadTarget.type === 'gallery') { data.site.gallery.items.push({ src:dataUrl, alt:'', caption:'', credit:'', category:data.site.gallery.categories[0] || 'Galerie', size:'medium', radius:'soft', width:100 }); selectedPath = `site.gallery.items.${data.site.gallery.items.length-1}`; }
    if (uploadTarget.type === 'block-image') { const blocks = getPath(uploadTarget.base) || []; blocks.push({ type:'image', src:dataUrl, alt:'', caption:'', radius:'soft', width:100 }); selectedPath = `${uploadTarget.base}.${blocks.length-1}`; }
    uploadTarget = null; markChanged(); showToast('Image optimisée et ajoutée');
  } catch (error) { showToast(error.message || 'Impossible de traiter cette image', true); setSaveState('Erreur'); }
}

function collectPublishData() {
  const copy = clone(data); const files = []; const seen = new Map();
  function walk(value, parent, key) {
    if (typeof value === 'string' && value.startsWith('data:image/')) {
      let path = seen.get(value);
      if (!path) { const [, mime = 'image/webp', base64 = ''] = value.match(/^data:([^;]+);base64,(.+)$/) || []; const extension = mime.includes('png') ? 'png' : 'webp'; path = `assets/uploads/${Date.now()}-${++uploadCounter}-${slugify(parent.caption || parent.alt || key)}.${extension}`; files.push({ path, content: base64, encoding: 'base64' }); seen.set(value, path); }
      parent[key] = path; return;
    }
    if (Array.isArray(value)) value.forEach((item, index) => walk(item, value, index));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => walk(child, value, childKey));
  }
  walk(copy, null, 'root'); return { ...copy, files };
}
async function publish() {
  if (localMode) return showToast('Publication désactivée dans la prévisualisation locale', true);
  try {
    dom.publish.disabled = true; dom.publish.textContent = 'Publication…'; setSaveState('Envoi à GitHub…');
    const payload = collectPublishData();
    const response = await fetch(`${apiBase}/api/publish`, { method:'POST', headers:authHeaders({ 'Content-Type':'application/json', 'X-Mayin-CSRF':csrf }), body:JSON.stringify({ site:payload.site, projects:{ projects:payload.projects }, files:payload.files, message:'Mise à jour depuis le Studio May’in' }) });
    if (response.status === 401) return showLogin();
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Publication refusée');
    data.site = payload.site; data.projects = payload.projects; localStorage.removeItem('mayin-studio-draft'); undoStack=[]; redoStack=[]; updateHistoryButtons(); setSaveState('Publié'); showToast('Le site est publié. Mise en ligne dans quelques instants.');
  } catch (error) { setSaveState('Échec'); showToast(error.message || 'Échec de la publication', true); }
  finally { dom.publish.disabled = false; dom.publish.textContent = 'Publier'; }
}

function showLogin() { dom.boot.hidden = true; dom.studio.hidden = true; dom.login.hidden = false; }
function showStudio() { dom.boot.hidden = true; dom.login.hidden = true; dom.studio.hidden = false; renderAllAdmin(); setTimeout(() => { sendDraft(); wirePreviewDocument(); }, 120); }
async function loadPublicData() {
  const [site, projects] = await Promise.all([fetch('../content/site.json',{cache:'no-store'}).then(r=>r.json()), fetch('../content/projects.json',{cache:'no-store'}).then(r=>r.json())]);
  apiBase = site.admin?.apiBase || ''; return { site, projects: projects.projects };
}
async function boot() {
  try {
    const fragment = new URLSearchParams(location.hash.slice(1));
    if (fragment.has('session')) { sessionToken = fragment.get('session'); sessionStorage.setItem('mayin-session', sessionToken); history.replaceState(null, '', location.pathname + location.search); }
    const publicData = await loadPublicData();
    if (localMode) { data = publicData; currentUser = { login:'local' }; const draft = localStorage.getItem('mayin-studio-draft'); if (draft) data = JSON.parse(draft); return showStudio(); }
    if (!apiBase || apiBase.includes('REMPLACER')) return showLogin();
    const auth = await fetch(`${apiBase}/auth/me`, { headers:authHeaders() }); if (!auth.ok) return showLogin();
    const account = await auth.json(); currentUser = account.user; csrf = account.csrf;
    const response = await fetch(`${apiBase}/api/content`, { headers:authHeaders() }); if (!response.ok) throw new Error('Contenu inaccessible');
    data = await response.json(); const draft = localStorage.getItem('mayin-studio-draft'); if (draft) { data = JSON.parse(draft); setSaveState('Brouillon restauré'); }
    showStudio();
  } catch (error) { console.error(error); showLogin(); showToast('Le service d’administration n’est pas encore disponible', true); }
}

dom.frame.addEventListener('load', () => setTimeout(() => { sendDraft(); wirePreviewDocument(); }, 60));
addEventListener('message', (event) => {
  if (event.source !== dom.frame.contentWindow || !event.data) return;
  if (event.data.type === 'mayin:preview-ready') sendDraft();
  if (event.data.type === 'mayin:select') { selectedPath = event.data.path; activePanel = ''; renderProjectList(); renderInspector(); revealInspector(); }
  if (event.data.type === 'mayin:inline') { if (inlineSessionPath !== event.data.path) { pushHistory(); inlineSessionPath = event.data.path; } setPath(event.data.path, event.data.value); markChanged(false); }
});
dom.loginButton.addEventListener('click', () => { if (!apiBase || apiBase.includes('REMPLACER')) return showToast('La connexion sécurisée est en cours de configuration', true); location.href = `${apiBase}/auth/login?returnTo=${encodeURIComponent(location.href)}`; });
dom.publish.addEventListener('click', publish); dom.undo.addEventListener('click', undo); dom.redo.addEventListener('click', redo);
dom.previewPublic.addEventListener('click', () => open(data.site.domain || '../index.html', '_blank', 'noopener'));
$$('.segmented').forEach((button) => button.addEventListener('click', () => setPreviewMode(button.dataset.mode)));
$$('[data-viewport]').forEach((button) => button.addEventListener('click', () => { $$('[data-viewport]').forEach(item=>item.classList.toggle('is-active',item===button)); dom.shell.className = `preview-shell preview-shell--${button.dataset.viewport}`; }));
dom.pageList.addEventListener('click', (event) => { const button=event.target.closest('[data-page]'); if (!button) return; activePanel=`page:${button.dataset.page}`; selectedPath=''; navigatePreview(button.dataset.href,button.dataset.page); renderInspector(); if(isCompact())openMobilePanel(''); });
dom.projectList.addEventListener('click', (event) => { const row=event.target.closest('[data-project-index]'); if(!row)return; const index=Number(row.dataset.projectIndex); selectedPath=`projects.${index}`; activePanel=''; navigatePreview(`../project.html?slug=${encodeURIComponent(data.projects[index].slug)}&admin-preview=1`,'projects'); renderProjectList(); renderInspector(); if(isCompact())openMobilePanel('properties'); });
$$('[data-panel]').forEach((button) => button.addEventListener('click', () => { activePanel=button.dataset.panel; selectedPath=''; renderInspector(); revealInspector(); }));
$('#add-project').addEventListener('click', () => { pushHistory(); const number=data.projects.length+1; data.projects.push({slug:`nouveau-projet-${number}`,title:`Nouveau projet ${number}`,category:'prive',description:'Description du projet à compléter.',cover:'',coverKind:'photo',coverRadius:'soft',layout:'wide',media:[],blocks:[]}); selectedPath=`projects.${data.projects.length-1}`; activePanel=''; markChanged(); });
$('#collapse-left').addEventListener('click', () => {
  if (isCompact()) return openMobilePanel('');
  const projects = $('#project-list');
  const hidden = projects.hidden;
  projects.hidden = !hidden;
  $('#collapse-left').textContent = hidden ? '‹' : '›';
});
$('#close-inspector').addEventListener('click', () => { renderEmpty(); if(isCompact())openMobilePanel(''); });
dom.mobileContent.addEventListener('click', () => openMobilePanel(dom.leftSidebar.classList.contains('is-open') ? '' : 'content'));
dom.mobileProperties.addEventListener('click', () => openMobilePanel(dom.rightSidebar.classList.contains('is-open') ? '' : 'properties'));
$('#account-button').addEventListener('click', () => { if (localMode) return showToast('Mode local'); sessionStorage.removeItem('mayin-session'); sessionToken=''; location.reload(); });
dom.imageInput.addEventListener('change', () => handleUpload(dom.imageInput.files[0]));
dom.inspector.addEventListener('focusin', (event) => { if (event.target.matches('[data-path]')) inlineSessionPath=''; });
dom.inspector.addEventListener('input', (event) => { if (event.target.type === 'range') event.target.nextElementSibling.textContent=`${event.target.value}%`; });
dom.inspector.addEventListener('change', (event) => {
  const input=event.target.closest('[data-path]'); if(!input)return; let value=input.type==='checkbox'?input.checked:input.value; if(input.type==='range')value=Number(value); pushHistory(); setPath(input.dataset.path,value); markChanged(false); sendDraft();
});
dom.inspector.addEventListener('click', (event) => {
  const upload=event.target.closest('[data-upload-path]'); if(upload)return startUpload({type:'path',path:upload.dataset.uploadPath});
  const choice=event.target.closest('[data-choice-path]'); if(choice){mutate(choice.dataset.choicePath,choice.dataset.choiceValue);return;}
  const select=event.target.closest('[data-select-path]'); if(select){selectedPath=select.dataset.selectPath;activePanel='';renderInspector();return;}
  const remove=event.target.closest('[data-remove-path]'); if(remove){pushHistory();deletePath(remove.dataset.removePath);selectedPath='';markChanged();return;}
  const move=event.target.closest('[data-move-path]'); if(move){moveItem(move.dataset.movePath,move.dataset.delta);return;}
  const addMedia=event.target.closest('[data-add-project-image]'); if(addMedia)return startUpload({type:'project-media',index:Number(addMedia.dataset.addProjectImage)});
  if(event.target.closest('[data-add-gallery-image]'))return startUpload({type:'gallery'});
  const addBlock=event.target.closest('[data-add-block]'); if(addBlock){const base=addBlock.dataset.blockBase;const type=addBlock.dataset.addBlock;if(type==='image')return startUpload({type:'block-image',base});pushHistory();const blocks=getPath(base)||[];const block=type==='quote'?{type,text:'Une citation à compléter.'}:type==='divider'?{type}:type==='spacer'?{type,height:80}:{type:'text',style:type==='lead'?'lead':'body',text:'Nouveau texte à compléter.'};blocks.push(block);selectedPath=`${base}.${blocks.length-1}`;activePanel='';markChanged();return;}
  const del=event.target.closest('[data-delete-project]'); if(del){pushHistory();data.projects.splice(Number(del.dataset.deleteProject),1);selectedPath='';markChanged();navigatePreview('../projets.html?admin-preview=1','projects');return;}
  const duplicate=event.target.closest('[data-duplicate-project]'); if(duplicate){pushHistory();const index=Number(duplicate.dataset.duplicateProject);const copy=clone(data.projects[index]);copy.title=`${copy.title} — copie`;copy.slug=`${copy.slug}-copie-${Date.now().toString(36)}`;data.projects.splice(index+1,0,copy);selectedPath=`projects.${index+1}`;markChanged();return;}
  const palette=event.target.closest('[data-palette]'); if(palette){mutate('site.design.activePalette',palette.dataset.palette);return;}
  if(event.target.closest('[data-duplicate-palette]')){pushHistory();const design=data.site.design;const source=clone(design.palettes.find(p=>p.id===design.activePalette));source.id=`${source.id}-copie-${Date.now().toString(36)}`;source.name=`${source.name} — copie`;design.palettes.push(source);design.activePalette=source.id;markChanged();return;}
  if(event.target.closest('[data-add-navigation]')){pushHistory();data.site.navigation.push({label:'Nouveau lien',href:'index.html',visible:true});markChanged();return;}
  if(event.target.closest('[data-add-social]')){pushHistory();data.site.socialLinks.push({label:'Nouveau lien',url:'https://',visible:true});markChanged();return;}
  if(event.target.closest('[data-add-gallery-category]')){pushHistory();data.site.gallery.categories.push('Nouvelle catégorie');markChanged();return;}
  if(event.target.closest('[data-export]')){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=`mayin-sauvegarde-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);showToast('Sauvegarde téléchargée');}
});

boot();
