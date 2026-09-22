const encoder = new TextEncoder();
const decoder = new TextDecoder();
const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(error);
      return responseJson({ error: 'Le service d’administration a rencontré une erreur.' }, 500, request, env);
    }
  }
};

async function route(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return corsPreflight(request, env);
  if (url.pathname === '/health') return responseJson({ ok: true, service: 'May’in Studio' }, 200, request, env);
  if (url.pathname === '/auth/login' && request.method === 'GET') return beginLogin(request, env);
  if (url.pathname === '/auth/callback' && request.method === 'GET') return finishLogin(request, env);
  const session = await requireSession(request, env);
  if (!session) return responseJson({ error: 'Connexion requise.' }, 401, request, env);
  if (url.pathname === '/auth/me' && request.method === 'GET') return responseJson({ user: { login: session.login, avatar: session.avatar }, csrf: session.csrf }, 200, request, env);
  if (url.pathname === '/api/content' && request.method === 'GET') return readContent(request, env, session);
  if (url.pathname === '/api/publish' && request.method === 'POST') {
    if (request.headers.get('X-Mayin-CSRF') !== session.csrf) return responseJson({ error: 'Session invalide.' }, 403, request, env);
    return publishContent(request, env, session);
  }
  return responseJson({ error: 'Route inconnue.' }, 404, request, env);
}

async function beginLogin(request, env) {
  assertConfig(env);
  const url = new URL(request.url);
  const state = randomToken(24);
  const requestedReturn = url.searchParams.get('returnTo') || `${env.SITE_ORIGIN}/admin/`;
  const returnTo = requestedReturn.startsWith(`${env.SITE_ORIGIN}/admin`) ? requestedReturn : `${env.SITE_ORIGIN}/admin/`;
  const statePayload = await seal({ state, returnTo, exp: Date.now() + 10 * 60_000 }, env.COOKIE_SECRET);
  const redirect = new URL('https://github.com/login/oauth/authorize');
  redirect.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  redirect.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
  redirect.searchParams.set('state', state);
  return new Response(null, { status: 302, headers: { Location: redirect.toString(), 'Set-Cookie': cookie('mayin_oauth', statePayload, 600, 'Lax'), ...securityHeaders() } });
}

async function finishLogin(request, env) {
  assertConfig(env);
  const url = new URL(request.url);
  const saved = await unseal(readCookie(request, 'mayin_oauth'), env.COOKIE_SECRET);
  if (!saved || saved.exp < Date.now() || saved.state !== url.searchParams.get('state')) return responseJson({ error: 'La connexion GitHub a expiré.' }, 400, request, env);
  const code = url.searchParams.get('code');
  if (!code) return responseJson({ error: 'Autorisation GitHub manquante.' }, 400, request, env);
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mayin-Studio' },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${url.origin}/auth/callback` })
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) return responseJson({ error: 'GitHub a refusé la connexion.' }, 401, request, env);
  const userResponse = await github('/user', tokenData.access_token);
  const user = await userResponse.json();
  if (!userResponse.ok || String(user.login).toLowerCase() !== String(env.ALLOWED_GITHUB_LOGIN).toLowerCase()) return responseJson({ error: 'Ce compte GitHub n’est pas autorisé.' }, 403, request, env);
  const session = await seal({ token: tokenData.access_token, login: user.login, avatar: user.avatar_url, csrf: randomToken(18), exp: Date.now() + 7.5 * 60 * 60_000 }, env.COOKIE_SECRET);
  const target = new URL(saved.returnTo);
  target.hash = `session=${encodeURIComponent(session)}`;
  return new Response(null, { status: 302, headers: { Location: target.toString(), 'Set-Cookie': cookie('mayin_oauth', '', 0, 'Lax'), ...securityHeaders() } });
}

async function requireSession(request, env) {
  const authorization = request.headers.get('Authorization') || '';
  const sealed = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const session = await unseal(sealed, env.COOKIE_SECRET);
  if (!session || session.exp < Date.now() || String(session.login).toLowerCase() !== String(env.ALLOWED_GITHUB_LOGIN).toLowerCase()) return null;
  return session;
}

async function readContent(request, env, session) {
  const [site, projects] = await Promise.all([
    readJsonFile('content/site.json', env, session.token),
    readJsonFile('content/projects.json', env, session.token)
  ]);
  return responseJson({ site, projects: projects.projects || [] }, 200, request, env);
}

async function publishContent(request, env, session) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > 18 * 1024 * 1024) return responseJson({ error: 'La publication dépasse 18 Mo. Ajoute les images en plusieurs fois.' }, 413, request, env);
  const payload = await request.json();
  if (!payload.site || !Array.isArray(payload.projects?.projects)) return responseJson({ error: 'Le contenu envoyé est incomplet.' }, 400, request, env);
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (files.length > 30) return responseJson({ error: 'Publie au maximum 30 nouvelles images à la fois.' }, 400, request, env);
  for (const file of files) {
    if (!/^assets\/uploads\/[a-zA-Z0-9._-]+$/.test(file.path || '') || file.encoding !== 'base64' || typeof file.content !== 'string') return responseJson({ error: 'Une image envoyée est invalide.' }, 400, request, env);
    if (file.content.length > 9_000_000) return responseJson({ error: `L’image ${file.path} est trop lourde.` }, 400, request, env);
  }
  const owner = env.GITHUB_OWNER; const repo = env.GITHUB_REPO; const branch = env.GITHUB_BRANCH || 'main';
  const ref = await githubJson(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, session.token);
  const headSha = ref.object.sha;
  const commit = await githubJson(`/repos/${owner}/${repo}/git/commits/${headSha}`, session.token);
  const entries = [
    { path: 'content/site.json', mode: '100644', type: 'blob', content: `${JSON.stringify(payload.site, null, 2)}\n` },
    { path: 'content/projects.json', mode: '100644', type: 'blob', content: `${JSON.stringify(payload.projects, null, 2)}\n` }
  ];
  for (const file of files) {
    const blob = await githubJson(`/repos/${owner}/${repo}/git/blobs`, session.token, { method: 'POST', body: JSON.stringify({ content: file.content, encoding: 'base64' }) });
    entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await githubJson(`/repos/${owner}/${repo}/git/trees`, session.token, { method: 'POST', body: JSON.stringify({ base_tree: commit.tree.sha, tree: entries }) });
  const newCommit = await githubJson(`/repos/${owner}/${repo}/git/commits`, session.token, { method: 'POST', body: JSON.stringify({ message: String(payload.message || 'Mise à jour depuis le Studio May’in').slice(0, 120), tree: tree.sha, parents: [headSha] }) });
  await githubJson(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, session.token, { method: 'PATCH', body: JSON.stringify({ sha: newCommit.sha, force: false }) });
  return responseJson({ ok: true, sha: newCommit.sha, url: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}` }, 200, request, env);
}

async function readJsonFile(path, env, token) {
  const response = await github(`/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(env.GITHUB_BRANCH || 'main')}`, token);
  const data = await response.json();
  if (!response.ok || !data.content) throw new Error(`Impossible de lire ${path}`);
  const bytes = Uint8Array.from(atob(data.content.replace(/\s/g, '')), (character) => character.charCodeAt(0));
  return JSON.parse(decoder.decode(bytes));
}

async function githubJson(path, token, options = {}) {
  const response = await github(path, token, options); const data = await response.json();
  if (!response.ok) throw new Error(data.message || `GitHub ${response.status}`);
  return data;
}
function github(path, token, options = {}) {
  return fetch(`https://api.github.com${path}`, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Mayin-Studio', ...(options.headers || {}) } });
}

function responseJson(value, status, request, env) {
  return new Response(JSON.stringify(value), { status, headers: { ...jsonHeaders, ...corsHeaders(request, env), ...securityHeaders() } });
}
function corsPreflight(request, env) {
  const origin = request.headers.get('Origin');
  if (origin !== env.SITE_ORIGIN) return new Response(null, { status: 403, headers: securityHeaders() });
  return new Response(null, { status: 204, headers: { ...corsHeaders(request, env), 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Mayin-CSRF', 'Access-Control-Max-Age': '86400', ...securityHeaders() } });
}
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  return origin === env.SITE_ORIGIN ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}
function securityHeaders() { return { 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' }; }
function cookie(name, value, maxAge, sameSite) { return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite}`; }
function readCookie(request, name) { const match = request.headers.get('Cookie')?.match(new RegExp(`(?:^|; )${name}=([^;]*)`)); return match ? match[1] : ''; }
function randomToken(bytes) { const array = crypto.getRandomValues(new Uint8Array(bytes)); return base64Url(array); }
function base64Url(bytes) { let binary = ''; bytes.forEach((byte) => binary += String.fromCharCode(byte)); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function fromBase64Url(value) { const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='); return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)); }
async function cryptoKey(secret) { const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret)); return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function seal(value, secret) { const iv = crypto.getRandomValues(new Uint8Array(12)); const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(secret), encoder.encode(JSON.stringify(value))); return `${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`; }
async function unseal(value, secret) { try { if (!value || !secret) return null; const [iv, encrypted] = value.split('.'); const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv) }, await cryptoKey(secret), fromBase64Url(encrypted)); return JSON.parse(decoder.decode(decrypted)); } catch { return null; } }
function assertConfig(env) { for (const name of ['GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','COOKIE_SECRET','SITE_ORIGIN','GITHUB_OWNER','GITHUB_REPO','ALLOWED_GITHUB_LOGIN']) if (!env[name]) throw new Error(`Configuration manquante: ${name}`); }
