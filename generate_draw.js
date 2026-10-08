#!/usr/bin/env node
// Run locally, then publish only draw_data.json. Keep join codes private.
const { randomInt, randomBytes, webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ITERATIONS = 300000;
const { subtle } = webcrypto;

function usage() {
  console.log('Usage: node generate_draw.js --file participants.json [--out draw_data.json]');
  console.log('   or: node generate_draw.js --names "Alice,Bob,Charlie" [--out draw_data.json]');
  console.log('   or: node generate_draw.js --demo');
}

function options(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--demo') result.demo = true;
    else if (['--file', '--names', '--out'].includes(flag) && argv[i + 1]) result[flag.slice(2)] = argv[++i];
    else throw new Error(`Unknown or incomplete option: ${flag}`);
  }
  const sources = [result.file, result.names, result.demo].filter(Boolean);
  if (sources.length !== 1) throw new Error('Choose exactly one of --file, --names, or --demo.');
  return result;
}

function getNames(opts) {
  const names = opts.demo
    ? ['Alice', 'Bob', 'Charlie', 'David', 'Eve']
    : opts.file
      ? JSON.parse(fs.readFileSync(path.resolve(opts.file), 'utf8'))
      : opts.names.split(',');
  if (!Array.isArray(names)) throw new Error('Participant file must contain a JSON array of names.');
  const clean = names.map(name => typeof name === 'string' ? name.trim() : '');
  if (clean.length < 2 || clean.length > 100) throw new Error('Provide between 2 and 100 participants.');
  if (clean.some(name => !name || name.length > 80)) throw new Error('Each name must contain 1–80 characters.');
  if (new Set(clean.map(name => name.toLocaleLowerCase())).size !== clean.length) {
    throw new Error('Participant names must be unique (ignoring case).');
  }
  return clean;
}

function shuffledDerangement(count) {
  const recipients = Array.from({ length: count }, (_, i) => i);
  // A uniformly shuffled permutation, rejected unless it has no fixed points.
  do {
    for (let i = count - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [recipients[i], recipients[j]] = [recipients[j], recipients[i]];
    }
  } while (recipients.some((recipient, i) => recipient === i));
  return recipients;
}

function newCode(used) {
  let code;
  do {
    code = Array.from({ length: 5 }, () => String.fromCharCode(65 + randomInt(26))).join('');
  } while (used.has(code));
  used.add(code);
  return code;
}

async function keyMaterialFor(code) {
  return subtle.importKey('raw', Buffer.from(code, 'utf8'), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
}

async function lookupTag(keyMaterial, lookupSalt) {
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: lookupSalt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return Buffer.from(bits).toString('hex');
}

async function encryptRecipient(recipient, code, lookupSalt) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const keyMaterial = await keyMaterialFor(code);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, key, Buffer.from(recipient, 'utf8'));
  return {
    codeTag: await lookupTag(keyMaterial, lookupSalt),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    encryptedRecipient: Buffer.from(encrypted).toString('base64')
  };
}

async function main() {
  let opts;
  try { opts = options(process.argv.slice(2)); }
  catch (error) { usage(); throw error; }
  const names = getNames(opts);
  const recipients = shuffledDerangement(names.length);
  const used = new Set();
  const codes = names.map(() => newCode(used));
  const lookupSalt = randomBytes(16);
  const assignments = await Promise.all(names.map(async (name, i) => ({
    name,
    ...await encryptRecipient(names[recipients[i]], codes[i], lookupSalt)
  })));
  const output = path.resolve(opts.out || 'draw_data.json');
  fs.writeFileSync(output, JSON.stringify({
    version: 1,
    demo: Boolean(opts.demo),
    lookupSalt: lookupSalt.toString('base64'),
    all_participants: names,
    assignments
  }, null, 2) + '\n', { flag: 'w' });
  console.log(`Wrote ${output}\n`);
  console.log('PRIVATE JOIN CODES — send each person only their own code:');
  names.forEach((name, i) => console.log(`${name}: ${codes[i]}`));
  console.log('\nSave these codes privately now. The script does not write a code list to disk.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
