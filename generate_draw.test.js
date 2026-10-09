const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { webcrypto } = require('node:crypto');

function runDraw(input) {
  const dir = mkdtempSync(path.join(tmpdir(), 'secret-santa-test-'));
  const file = path.join(dir, 'participants.json');
  const output = path.join(dir, 'draw.json');
  writeFileSync(file, JSON.stringify(input));
  const result = spawnSync(process.execPath, [path.join(__dirname, 'generate_draw.js'), '--file', file, '--out', output], {
    encoding: 'utf8'
  });
  return { ...result, output, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function reveal(assignment, code) {
  const { subtle } = webcrypto;
  const material = await subtle.importKey('raw', Buffer.from(code), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({
    name: 'PBKDF2', salt: Buffer.from(assignment.salt, 'base64'), iterations: 300000, hash: 'SHA-256'
  }, material, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return Buffer.from(await subtle.decrypt({
    name: 'AES-GCM', iv: Buffer.from(assignment.iv, 'base64')
  }, key, Buffer.from(assignment.encryptedRecipient, 'base64'))).toString();
}

test('respects two-way and one-way exclusions while assigning everyone once', async () => {
  const run = runDraw({
    disallowedPairings: [['Alice', 'Bob']],
    disallowedRecipients: { Charlie: ['Eve'] },
    participants: ['Alice', 'Bob', 'Charlie', 'David', 'Eve']
  });
  try {
    assert.equal(run.status, 0, run.stderr);
    const data = JSON.parse(readFileSync(run.output, 'utf8'));
    const recipients = [];
    for (const assignment of data.assignments) {
      const match = run.stdout.match(new RegExp(`^${assignment.name}: ([A-Z]{5})$`, 'm'));
      assert.ok(match, `Missing code for ${assignment.name}`);
      const recipient = await reveal(assignment, match[1]);
      assert.notEqual(recipient, assignment.name);
      assert.ok(!(assignment.name === 'Alice' && recipient === 'Bob'));
      assert.ok(!(assignment.name === 'Bob' && recipient === 'Alice'));
      assert.ok(!(assignment.name === 'Charlie' && recipient === 'Eve'));
      recipients.push(recipient);
    }
    assert.deepEqual(recipients.sort(), [...data.all_participants].sort());
  } finally { run.cleanup(); }
});

test('rejects impossible exclusions without creating output', () => {
  const run = runDraw({ participants: ['Alice', 'Bob', 'Charlie'], disallowedPairings: [['Alice', 'Bob'], ['Alice', 'Charlie']] });
  try {
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /No valid draw is possible/);
    assert.equal(existsSync(run.output), false);
  } finally { run.cleanup(); }
});

test('accepts the original array format', () => {
  const run = runDraw(['Alice', 'Bob', 'Charlie']);
  try {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(readFileSync(run.output, 'utf8')).assignments.length, 3);
  } finally { run.cleanup(); }
});
