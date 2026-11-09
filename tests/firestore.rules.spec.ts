/**
 * Security rules tests. Run with the Firestore emulator:
 *   npm run test:rules
 */
import { RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { deleteDoc, doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeEach, describe, it } from 'vitest';

let env: RulesTestEnvironment;

beforeEach(async () => {
  env ??= await initializeTestEnvironment({
    projectId: 'demo-ledgerline',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await env.clearFirestore();
});
afterAll(async () => env?.cleanup());

const ALLOWED = { email: 'janardhan579.n@gmail.com', email_verified: true };
const user = (uid: string, token: Record<string, unknown> = ALLOWED) => env.authenticatedContext(uid, token).firestore();

const month = { month: '2026-10', items: [{ id: 't1', amount: 10 }] };

describe('a user\'s own data', () => {
  it('can be written and read by its owner', async () => {
    const db = user('alice');
    await assertSucceeds(setDoc(doc(db, 'users/alice/ledger/settings'), { primary: 'MYR' }));
    await assertSucceeds(setDoc(doc(db, 'users/alice/months/2026-10'), month));
    await assertSucceeds(getDoc(doc(db, 'users/alice/months/2026-10')));
    await assertSucceeds(deleteDoc(doc(db, 'users/alice/months/2026-10')));
  });

  it('is invisible and read-only to other signed-in users', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'users/alice/months/2026-10'), month));
    const bob = user('bob');
    await assertFails(getDoc(doc(bob, 'users/alice/months/2026-10')));
    await assertFails(setDoc(doc(bob, 'users/alice/months/2026-10'), month));
    await assertFails(deleteDoc(doc(bob, 'users/alice/months/2026-10')));
  });

  it('is closed to signed-out visitors', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'users/alice/ledger/settings')));
    await assertFails(setDoc(doc(anon, 'users/alice/ledger/settings'), { primary: 'MYR' }));
  });
});

const person = (uid: string) => user(uid, { email: `${uid}@gmail.com`, email_verified: true });
async function claim(uid: string, seat: string) {
  const db = person(uid);
  const b = writeBatch(db);
  b.set(doc(db, 'seats', seat), { uid });
  b.set(doc(db, 'members', uid), { seat, email: `${uid}@gmail.com`, joinedAt: '2026-11-09T00:00:00Z' });
  return b.commit();
}

describe('five seats', () => {
  it('lets the first five accounts in and blocks the sixth', async () => {
    for (const [i, uid] of ['a', 'b', 'c', 'd', 'e'].entries()) await assertSucceeds(claim(uid, String(i + 1)));
    for (const seat of ['1', '2', '3', '4', '5', '6']) await assertFails(claim('f', seat));
    await assertSucceeds(setDoc(doc(person('e'), 'users/e/ledger/settings'), { primary: 'INR' }));
    await assertFails(setDoc(doc(person('f'), 'users/f/ledger/settings'), { primary: 'INR' }));
  });
  it('never lets two people share a seat or one person take two', async () => {
    await assertSucceeds(claim('a', '1'));
    await assertFails(claim('b', '1'));
    await assertFails(claim('a', '2'));
  });
  it('rejects a member record without its seat, or with someone else\'s email', async () => {
    const db = person('x');
    await assertFails(setDoc(doc(db, 'members', 'x'), { seat: '1', email: 'x@gmail.com', joinedAt: 'now' }));
    const b = writeBatch(db);
    b.set(doc(db, 'seats', '1'), { uid: 'x' });
    b.set(doc(db, 'members', 'x'), { seat: '1', email: 'boss@gmail.com', joinedAt: 'now' });
    await assertFails(b.commit());
  });
  it('lets people read only their own member record', async () => {
    await assertSucceeds(claim('a', '1'));
    await assertSucceeds(getDoc(doc(person('a'), 'members', 'a')));
    await assertFails(getDoc(doc(person('b'), 'members', 'a')));
  });
  it('keeps the owner in even when all seats are taken', async () => {
    for (const [i, uid] of ['a', 'b', 'c', 'd', 'e'].entries()) await assertSucceeds(claim(uid, String(i + 1)));
    await assertSucceeds(setDoc(doc(user('owner'), 'users/owner/ledger/settings'), { primary: 'MYR' }));
  });
});

describe('allow-list', () => {
  it('refuses Google accounts without a seat, even for their own folder', async () => {
    const stranger = user('mallory', { email: 'someone@gmail.com', email_verified: true });
    await assertFails(setDoc(doc(stranger, 'users/mallory/ledger/settings'), { primary: 'MYR' }));
    await assertFails(getDoc(doc(stranger, 'users/mallory/ledger/settings')));
  });
  it('refuses unverified emails', async () => {
    const unverified = user('eve', { email: 'janardhan579.n@gmail.com', email_verified: false });
    await assertFails(setDoc(doc(unverified, 'users/eve/ledger/settings'), { primary: 'MYR' }));
  });
});

describe('receipt copies', () => {
  const receipt = { id: 'r1', name: 'tesco.jpg', mime: 'image/jpeg', data: 'aGVsbG8=', size: 5, createdAt: '2026-11-09T00:00:00Z' };
  it('can be stored and read by the owner only', async () => {
    const alice = user('alice');
    await assertSucceeds(setDoc(doc(alice, 'users/alice/receipts/r1'), receipt));
    await assertSucceeds(getDoc(doc(alice, 'users/alice/receipts/r1')));
    const bob = user('bob');
    await assertFails(getDoc(doc(bob, 'users/alice/receipts/r1')));
  });
  it('rejects oversized or unexpected receipt documents', async () => {
    const alice = user('alice');
    await assertFails(setDoc(doc(alice, 'users/alice/receipts/r1'), { ...receipt, data: 'x'.repeat(700001) }));
    await assertFails(setDoc(doc(alice, 'users/alice/receipts/r1'), { ...receipt, mime: 'text/html' }));
    await assertFails(setDoc(doc(alice, 'users/alice/receipts/r2'), receipt));
    await assertFails(setDoc(doc(alice, 'users/alice/receipts/r1'), { ...receipt, extra: 1 }));
  });
});

describe('document shape', () => {
  it('rejects unknown ledger documents and malformed months', async () => {
    const db = user('alice');
    await assertFails(setDoc(doc(db, 'users/alice/ledger/admin'), { role: 'admin' }));
    await assertFails(setDoc(doc(db, 'users/alice/months/2026-13'), { month: '2026-13', items: [] }));
    await assertFails(setDoc(doc(db, 'users/alice/months/2026-10'), { month: '2026-11', items: [] }));
    await assertFails(setDoc(doc(db, 'users/alice/months/2026-10'), { month: '2026-10', items: [], extra: true }));
  });

  it('denies everything outside /users/{uid}', async () => {
    const db = user('alice');
    await assertFails(setDoc(doc(db, 'public/rates'), { x: 1 }));
    await assertFails(getDoc(doc(db, 'users/alice')));
  });
});
