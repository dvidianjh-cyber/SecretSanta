const views = ['login', 'dashboard', 'animation', 'reveal'];
const byId = id => document.getElementById(id);
const encoder = new TextEncoder();
let drawData;
let participant;
let joinCode;
let drawing = false;

function showView(name) {
  views.forEach(view => { byId(`${view}-view`).hidden = view !== name; });
}

function setError(id, message) {
  const element = byId(id);
  element.textContent = message;
  element.hidden = !message;
}

function cleanCode(value) { return value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5); }

function base64Bytes(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

async function codeTag(code, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bytes = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: base64Bytes(salt), iterations: 300000, hash: 'SHA-256' },
    material,
    256
  ));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function decryptRecipient(assignment, code) {
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(code), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: base64Bytes(assignment.salt), iterations: 300000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64Bytes(assignment.iv) },
    key,
    base64Bytes(assignment.encryptedRecipient)
  );
  const name = new TextDecoder().decode(clear);
  if (!drawData.all_participants.includes(name) || name === assignment.name) throw new Error('Invalid draw data.');
  return name;
}

async function loadData() {
  if (drawData) return drawData;
  const response = await fetch('draw_data.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('The draw is not ready yet. Please ask your organiser.');
  const data = await response.json();
  if (data.version !== 1 || typeof data.lookupSalt !== 'string' || !Array.isArray(data.all_participants) || !Array.isArray(data.assignments)) {
    throw new Error('The draw data is invalid. Please ask your organiser.');
  }
  drawData = data;
  return data;
}

byId('join-code').addEventListener('input', event => {
  event.target.value = cleanCode(event.target.value);
  setError('login-error', '');
});

byId('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const code = cleanCode(byId('join-code').value);
  if (code.length !== 5) { setError('login-error', 'Please enter your five-letter code.'); return; }
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  setError('login-error', '');
  try {
    const data = await loadData();
    const tag = await codeTag(code, data.lookupSalt);
    const match = data.assignments.find(item => item.codeTag === tag);
    if (!match) { setError('login-error', 'That code was not found. Check the letters and try again.'); return; }
    participant = match;
    joinCode = code;
    byId('participant-name').textContent = match.name;
    showView('dashboard');
  } catch (error) {
    setError('login-error', error.message || 'Unable to load the draw. Please try again.');
  } finally { button.disabled = false; }
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

byId('draw-button').addEventListener('click', async () => {
  if (drawing) return;
  drawing = true;
  setError('draw-error', '');
  showView('animation');
  const names = drawData.all_participants;
  const reel = byId('reel-name');
  let timer;
  let lastName = '';
  const spin = () => {
    const alternatives = names.filter(name => name !== lastName);
    lastName = alternatives[Math.floor(Math.random() * alternatives.length)] || names[0];
    reel.textContent = lastName;
  };
  spin();
  timer = setInterval(spin, 85);
  try {
    const [recipient] = await Promise.all([decryptRecipient(participant, joinCode), sleep(1700)]);
    clearInterval(timer);
    for (const delay of [160, 220, 300, 420]) { spin(); await sleep(delay); }
    reel.textContent = recipient;
    await sleep(550);
    byId('recipient-name').textContent = recipient;
    showView('reveal');
  } catch {
    clearInterval(timer);
    showView('dashboard');
    setError('draw-error', 'We could not reveal your match. Please ask your organiser to regenerate the draw.');
  } finally { drawing = false; }
});

byId('start-over').addEventListener('click', () => {
  participant = undefined;
  joinCode = undefined;
  byId('join-code').value = '';
  showView('login');
  byId('join-code').focus();
});

if (!window.crypto?.subtle) {
  setError('login-error', 'This page needs a secure connection (HTTPS) to open your draw.');
  byId('login-form').querySelector('button').disabled = true;
}
