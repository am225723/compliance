/**
 * Google Drive integration via Google Picker API + Drive REST API.
 * Uses gapi (Google API client library) loaded dynamically.
 */

const CLIENT_ID_KEY = 'gd_client_id';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

let tokenClient = null;
let accessToken = null;

export function saveClientId(id) {
  localStorage.setItem(CLIENT_ID_KEY, id);
}
export function loadClientId() {
  return localStorage.getItem(CLIENT_ID_KEY) || '';
}
export function getAccessToken() {
  return accessToken;
}
export function setAccessToken(token) {
  accessToken = token;
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

export async function initGoogleAuth(clientId) {
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (resp) => {
        if (resp.error) { reject(resp); return; }
        accessToken = resp.access_token;
        resolve(resp.access_token);
      },
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

async function driveRequest(path, options = {}) {
  const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
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

/** List files inside a patient folder (only target types) */
export async function listPatientFiles(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const data = await driveRequest(`/files?q=${q}&fields=files(id,name,mimeType,size)&pageSize=200&spaces=drive`);
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

/** Upload/create a file in a folder */
export async function uploadFile(folderId, fileName, content, mimeType = 'text/html') {
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType,
  };
  const boundary = '-------314159265358979323846';
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
    typeof content === 'string' ? content : '',
    `--${boundary}--`,
  ].join('\r\n');

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
