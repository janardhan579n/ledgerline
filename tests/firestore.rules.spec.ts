/**
 * Security rules tests. Run with the Firestore emulator:
 *   npm run test:rules
 */
import { RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';
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

const month = { month: '2026-10', items: [{ id: 't1', amount: 10 }] };

describe('a user\'s own data', () => {
  it('can be written and read by its owner', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertSucceeds(setDoc(doc(db, 'users/alice/ledger/settings'), { primary: 'MYR' }));
    await assertSucceeds(setDoc(doc(db, 'users/alice/months/2026-10'), month));
    await assertSucceeds(getDoc(doc(db, 'users/alice/months/2026-10')));
    await assertSucceeds(deleteDoc(doc(db, 'users/alice/months/2026-10')));
  });

  it('is invisible and read-only to other signed-in users', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'users/alice/months/2026-10'), month));
    const bob = env.authenticatedContext('bob').firestore();
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

describe('document shape', () => {
  it('rejects unknown ledger documents and malformed months', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'users/alice/ledger/admin'), { role: 'admin' }));
    await assertFails(setDoc(doc(db, 'users/alice/months/2026-13'), { month: '2026-13', items: [] }));
    await assertFails(setDoc(doc(db, 'users/alice/months/2026-10'), { month: '2026-11', items: [] }));
    await assertFails(setDoc(doc(db, 'users/alice/months/2026-10'), { month: '2026-10', items: [], extra: true }));
  });

  it('denies everything outside /users/{uid}', async () => {
    const db = env.authenticatedContext('alice').firestore();
    await assertFails(setDoc(doc(db, 'public/rates'), { x: 1 }));
    await assertFails(getDoc(doc(db, 'users/alice')));
  });
});
