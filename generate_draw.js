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

function getDrawConfig(opts) {
  const input = opts.demo
    ? ['Alice', 'Bob', 'Charlie', 'David', 'Eve']
    : opts.file
      ? JSON.parse(fs.readFileSync(path.resolve(opts.file), 'utf8'))
      : opts.names.split(',');
  const config = Array.isArray(input) ? { participants: input } : input;
  if (!config || typeof config !== 'object') {
    throw new Error('Participant file must contain an array or a configuration object.');
  }
  const { participants: names, disallowedPairings = [], disallowedRecipients = {} } = config;
  if (!Array.isArray(names)) throw new Error('Participant file must contain a JSON array of names.');
  const clean = names.map(name => typeof name === 'string' ? name.trim() : '');
  if (clean.length < 2 || clean.length > 100) throw new Error('Provide between 2 and 100 participants.');
  if (clean.some(name => !name || name.length > 80)) throw new Error('Each name must contain 1–80 characters.');
  if (new Set(clean.map(name => name.toLocaleLowerCase())).size !== clean.length) {
    throw new Error('Participant names must be unique (ignoring case).');
  }
  if (!Array.isArray(disallowedPairings)) throw new Error('disallowedPairings must be an array of two-name arrays.');
  if (!disallowedRecipients || typeof disallowedRecipients !== 'object' || Array.isArray(disallowedRecipients)) {
    throw new Error('disallowedRecipients must be an object mapping giver names to recipient arrays.');
  }

  const byName = new Map(clean.map((name, i) => [name.toLocaleLowerCase(), i]));
  const indexFor = name => {
    const index = typeof name === 'string' ? byName.get(name.trim().toLocaleLowerCase()) : undefined;
    if (index === undefined) throw new Error(`Unknown participant in exclusions: ${JSON.stringify(name)}.`);
    return index;
  };
  const blocked = clean.map((_, i) => new Set([i]));
  for (const pair of disallowedPairings) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error('Each disallowed pairing must contain exactly two names.');
    const [first, second] = pair.map(indexFor);
    if (first === second) throw new Error('A disallowed pairing must name two different participants.');
    blocked[first].add(second);
    blocked[second].add(first);
  }
  for (const [giver, recipients] of Object.entries(disallowedRecipients)) {
    if (!Array.isArray(recipients)) throw new Error(`disallowedRecipients for ${giver} must be an array.`);
    const giverIndex = indexFor(giver);
    for (const recipient of recipients) blocked[giverIndex].add(indexFor(recipient));
  }
  return { names: clean, blocked };
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function drawRecipients(blocked) {
  const count = blocked.length;
  const giverForRecipient = Array(count).fill(-1);
  const choices = blocked.map(exclusions => shuffle(
    Array.from({ length: count }, (_, i) => i).filter(i => !exclusions.has(i))
  ));
  function assign(giver, visited) {
    for (const recipient of choices[giver]) {
      if (visited.has(recipient)) continue;
      visited.add(recipient);
      const previousGiver = giverForRecipient[recipient];
      if (previousGiver === -1 || assign(previousGiver, visited)) {
        giverForRecipient[recipient] = giver;
        return true;
      }
    }
    return false;
  }
  for (const giver of shuffle(Array.from({ length: count }, (_, i) => i))) {
    if (!assign(giver, new Set())) {
      throw new Error('No valid draw is possible with these exclusions. Please relax the rules and try again.');
    }
  }
  const recipientForGiver = Array(count);
  giverForRecipient.forEach((giver, recipient) => { recipientForGiver[giver] = recipient; });
  return recipientForGiver;
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
  const { names, blocked } = getDrawConfig(opts);
  const recipients = drawRecipients(blocked);
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
