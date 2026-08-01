/**
 * Google Drive integration via Google Identity Services (GIS) token client + Drive REST API.
 * Uses gapi/GIS loaded dynamically.
 *
 * Token lifecycle:
 *   - The OAuth access token + its expiry are persisted to sessionStorage so a
 *     page refresh doesn't silently drop the "Connected" state, while still
 *     bounding how long a token (now covering Drive + Calendar read access)
 *     sits on disk — it's gone once the tab/browser closes, unlike
 *     localStorage. Any script on the page can still read it (that's true of
 *     both storages equally), so this narrows the exposure window rather
 *     than eliminating it.
 *   - Every Drive request goes through `ensureValidToken()`, which transparently
 *     performs a silent (no-popup) token refresh when the current token is
 *     missing or close to expiring, so long-running batches don't die mid-run
 *     with a raw 401.
 */

const CLIENT_ID_KEY = 'gd_client_id';
const TOKEN_KEY = 'gd_token';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
// Every token request asks for both scopes together. Existing connections
// made before Calendar support was added won't have the calendar scope on
// their cached token — see hasCalendarScope()/needsCalendarReconnect() below.
const COMBINED_SCOPE = `${DRIVE_SCOPE} ${CALENDAR_READONLY_SCOPE}`;
// Refresh proactively this many ms before actual expiry.
const REFRESH_BUFFER_MS = 3 * 60 * 1000;
// Google access tokens are typically valid ~1hr; fall back to a conservative default
// if a response is ever missing `expires_in`.
const DEFAULT_TTL_MS = 55 * 60 * 1000;

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0; // epoch ms
let grantedScope = '';

function persistToken(token, expiresInSec, scope) {
  accessToken = token;
  tokenExpiresAt = Date.now() + (expiresInSec ? expiresInSec * 1000 : DEFAULT_TTL_MS);
  if (scope) grantedScope = scope;
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: token, expires_at: tokenExpiresAt, scope: grantedScope }));
  } catch { /* sessionStorage unavailable — token just won't survive a refresh */ }
}

function rehydrateToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return;
    const { access_token, expires_at, scope } = JSON.parse(raw);
    if (access_token && expires_at && expires_at - Date.now() > REFRESH_BUFFER_MS) {
      accessToken = access_token;
      tokenExpiresAt = expires_at;
      grantedScope = scope || '';
    }
  } catch { /* ignore malformed cache */ }
}
rehydrateToken();

// VITE_GOOGLE_CLIENT_ID, when set at build time, makes the Client ID
// "permanent" for the whole deployment rather than something each browser
// has to be told about separately — it's safe to bake into the client
// bundle since Google Identity Services client IDs are public identifiers
// (security comes from the "Authorized origins" allowlist in Google Cloud
// Console, not secrecy). It always wins over a locally saved value.
const ENV_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export function saveClientId(id) {
  try { localStorage.setItem(CLIENT_ID_KEY, id); } catch { /* blocked/unavailable storage — value still lives in React state for this session */ }
}
export function loadClientId() {
  return ENV_CLIENT_ID || localStorage.getItem(CLIENT_ID_KEY) || '';
}
export function getAccessToken() {
  return accessToken;
}
export function setAccessToken(token) {
  // Legacy setter kept for callers that already hold a token (e.g. right after
  // initGoogleAuth resolves) — does not know the expiry, so assume the default TTL.
  if (token) persistToken(token, undefined);
  else clearToken();
}
export function isTokenValid() {
  return !!accessToken && tokenExpiresAt - Date.now() > REFRESH_BUFFER_MS;
}
export function getTokenExpiry() {
  return tokenExpiresAt;
}
export function clearToken() {
  accessToken = null;
  tokenExpiresAt = 0;
  grantedScope = '';
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

/** Has the current Drive connection also been granted Calendar read access? */
export function hasCalendarScope() {
  // Prefer Google's own scope-check helper when GIS is loaded — it's more
  // robust to scope-string formatting than a manual split/includes.
  if (window.google?.accounts?.oauth2?.hasGrantedAllScopes) {
    return window.google.accounts.oauth2.hasGrantedAllScopes({ scope: grantedScope }, CALENDAR_READONLY_SCOPE);
  }
  return grantedScope.split(' ').includes(CALENDAR_READONLY_SCOPE);
}

/** True when Drive is connected but the user still needs to (re)consent to add Calendar access. */
export function needsCalendarReconnect() {
  return isTokenValid() && !hasCalendarScope();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function ensureGis() {
  if (window.google?.accounts?.oauth2) return;
  await loadScript('https://accounts.google.com/gsi/client');
}

function getTokenClient(clientId) {
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: COMBINED_SCOPE,
      callback: () => {}, // overridden per-request below
    });
  }
  return tokenClient;
}

/**
 * Request an access token. `silent: true` asks GIS for a token without a
 * popup/consent prompt — this only succeeds if the browser already has an
 * active Google session that previously granted this scope.
 */
export async function initGoogleAuth(clientId, { silent = false } = {}) {
  await ensureGis();
  saveClientId(clientId);
  return new Promise((resolve, reject) => {
    const client = getTokenClient(clientId);
    client.callback = (resp) => {
      if (resp.error) { reject(resp); return; }
      persistToken(resp.access_token, resp.expires_in, resp.scope);
      resolve(resp.access_token);
    };
    client.requestAccessToken({ prompt: silent ? '' : 'consent' });
  });
}

/**
 * Re-prompt for consent so an existing Drive-only connection (made before
 * Calendar support existed) can pick up the Calendar read-only scope,
 * without losing Drive access — the token client always requests both
 * scopes together, so a single consent grants whichever are still missing.
 */
export async function reconnectGoogleAuth(clientId) {
  return initGoogleAuth(clientId, { silent: false });
}

/**
 * Guarantee a usable access token before a Drive call: reuses the current
 * token if it's still fresh, otherwise attempts a silent refresh. Throws a
 * user-actionable error if the caller needs to reconnect via Settings.
 */
export async function ensureValidToken() {
  if (isTokenValid()) return accessToken;
  const clientId = loadClientId();
  if (!clientId) throw new Error('Google Drive not configured. Add your OAuth Client ID in Settings.');
  try {
    return await initGoogleAuth(clientId, { silent: true });
  } catch {
    clearToken();
    throw new Error('Google Drive session expired. Please reconnect in Settings.');
  }
}

async function driveRequest(path, options = {}, _retried = false) {
  await ensureValidToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && !_retried) {
    clearToken();
    return driveRequest(path, options, true);
  }
  if (!res.ok) throw new Error(`Drive API error ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Find the top-level PatientForms folder */
export async function findPatientFormsFolder() {
  const q = encodeURIComponent(`name = 'PatientForms' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const data = await driveRequest(`/files?q=${q}&fields=files(id,name)&spaces=drive`);
  if (!data.files || data.files.length === 0) throw new Error('PatientForms folder not found in Drive.');
  return data.files[0];
}

/** List all subfolders inside a parent folder */
export async function listSubfolders(parentId) {
  const q = encodeURIComponent(`'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const data = await driveRequest(`/files?q=${q}&fields=files(id,name)&pageSize=1000&spaces=drive`);
  return data.files || [];
}

/**
 * List files inside a patient folder (only target types). When `sinceIso` is
 * given, only files modified after that timestamp are returned — used by the
 * AutoPilot watcher to detect new/changed source documents.
 */
export async function listPatientFiles(folderId, sinceIso = null) {
  let q = `'${folderId}' in parents and trashed = false`;
  if (sinceIso) q += ` and modifiedTime > '${sinceIso}'`;
  const query = encodeURIComponent(q);
  const data = await driveRequest(`/files?q=${query}&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=200&spaces=drive`);
  const all = data.files || [];
  // Filter to target files only
  return all.filter(f => isTargetFile(f.name));
}

export function isTargetFile(name) {
  const lower = name.toLowerCase();
  return (
    lower.endsWith('intake.pdf') ||
    lower.includes('pre-session') ||
    lower.includes('presession') ||
    lower.includes('pre_session') ||
    lower.includes('transcript') ||
    lower.includes('test result') ||
    lower.includes('test_result') ||
    lower.includes('evaluation') ||
    lower.includes('lab') ||
    lower.includes('psychological')
  );
}

/** Download a file's text content */
export async function downloadFileText(fileId, mimeType) {
  await ensureValidToken();
  let url;
  if (mimeType === 'application/vnd.google-apps.document') {
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
  } else {
    url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Download error ${res.status}`);
  // For PDFs, return as ArrayBuffer; for text return string
  if (mimeType === 'application/pdf') {
    const buf = await res.arrayBuffer();
    return buf;
  }
  return res.text();
}

/**
 * Upload/create a file in a folder. `content` may be a string (text/html),
 * or a Blob/ArrayBuffer/typed array for binary content (e.g. a real PDF) —
 * the multipart body is built as a Blob so binary bytes aren't corrupted by
 * being coerced through a JS string.
 */
export async function uploadFile(folderId, fileName, content, mimeType = 'text/html') {
  await ensureValidToken();
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType,
  };
  const boundary = '-------314159265358979323846';
  const preamble =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;

  const contentPart =
    content instanceof Blob ? content
    : (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) ? new Blob([content])
    : new Blob([typeof content === 'string' ? content : '']);

  const body = new Blob([preamble, contentPart, closing]);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary="${boundary}"`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Upload error ${res.status}: ${await res.text()}`);
  return res.json();
}
