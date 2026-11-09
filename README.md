# Ledgerline

Personal finance across currencies: salary, spending, budgets, savings goals, reports and guidance.
Angular 22 (standalone components, signals, NgRx Signal Store) on Firebase (Google sign-in, Firestore, Hosting).

## Run it locally (no setup)

```bash
npm install
npm start          # http://localhost:4200
```

With no Firebase config the app runs in **demo mode**: "Try the demo" signs you in as a local user and nothing is saved.

## Put it online privately (about 15 minutes, free tier)

1. **Create a project** at <https://console.firebase.google.com> → *Add project*. Google Analytics isn't needed.
2. **Turn on sign-in:** *Build → Authentication → Get started → Sign-in method → Google → Enable*.
3. **Create the database:** *Build → Firestore Database → Create database*. Pick a location near you (for example `asia-southeast1`, Singapore) and start in **production mode**. The rules in this repo replace the default ones on deploy.
4. **Register the web app:** *Project settings → Your apps → Web (</>)*. Copy the `firebaseConfig` values into `src/environments/firebase.config.ts`. These values identify your project; they are not secrets.
5. **Deploy:**
   ```bash
   npm install -g firebase-tools     # or use npx firebase
   firebase login
   firebase use --add                # pick your project (creates .firebaserc)
   npm run deploy                    # builds, then deploys hosting + Firestore rules
   ```
   Your app is live at `https://personal-ledger.web.app`. Open it on your phone and use *Add to Home Screen* to install it.

### Optional: only allow specific people

By default anyone with a Google account can sign in. Each person still only ever sees their own data, but they would use your free quota. To restrict sign-in to you and your family, edit `isOwner()` in `firestore.rules` (the allow-list is already written there, commented out), then run `npm run deploy:rules`.

Turning on two-step verification for your Google account protects the app too, since that's your login.

## Scanning receipts and payslips

Tap **Scan** (or **Scan a receipt or payslip** in the Add form), choose photos or PDFs, check the suggested transactions, and save. It handles receipts, bills, invoices (yours or ones you paid), payslips (recorded as net pay, with gross and deductions in the notes) and bank statements (one transaction per line). Likely duplicates of existing transactions are flagged and left unticked.

**Turn it on once (free):** Firebase console → **AI Services → AI Logic → Get started → Gemini Developer API**. That's all; no billing account is needed.

- **Cost:** the Gemini Developer API free tier is used, at roughly 10 requests a minute and a daily cap. Files are read one at a time.
- **Privacy:** on the free tier Google may use what you send to improve its products, and human reviewers may read it. If you'd rather avoid that, link a billing account (Blaze plan); then your files aren't used for training, at a cost of a few cents a month for personal use.
- **Models:** set in `src/environments/firebase.config.ts` (`aiConfig.models`), tried in order. Update the list if Google retires a model.
- **Receipt copies:** if "Keep a small copy" is ticked, photos are shrunk to about 300 KB and stored in `users/{uid}/receipts/`, readable only by you. Open one from the transaction with **View receipt**.
- **Protect your AI quota (App Check):** anyone who copies your web config could use your free AI requests. App Check stops that:
  1. Google Cloud console (project ledgerline-4e2d3) → **Security → Fraud Defense** (formerly reCAPTCHA Enterprise) → **Create key**: platform **Website**, add domains `personal-ledger.web.app`, `ledgerline-4e2d3.web.app`, `ledgerline-4e2d3.firebaseapp.com`, `localhost`; no checkbox challenge. Copy the key ID.
  2. Firebase console → **App Check → Apps** → your web app → **reCAPTCHA Enterprise / Fraud Defense** → paste the key ID → Save. Set the token time-to-live to 1 day to use fewer of the 10,000 free monthly checks.
  3. Put the key ID in `aiConfig.appCheckSiteKey`, build and deploy.
  4. In **App Check → APIs**, enforce **Firebase AI Logic** (and later Cloud Firestore, once its chart shows almost all requests verified).
  Classic reCAPTCHA v3 keys can no longer be registered with App Check.

## How data is protected

| Layer | What it does |
|---|---|
| Google sign-in (Firebase Auth) | Identity, sessions and two-step verification are handled by Google. The app never sees a password. |
| `firestore.rules` | Every document lives under `users/{uid}/…`. Only the signed-in owner can read or write it; everything else is denied. Document names and shapes are also checked. |
| Hosting headers (`firebase.json`) | HTTPS only (HSTS), a strict Content Security Policy, no framing, no camera/mic/location access. |
| No secrets in the code | The Firebase config is public by design; access is decided by the rules. |
| Offline cache | Firestore keeps a copy in this browser's storage so the app opens offline. Signing out wipes that copy from the device. |

Test the rules against the local emulator (needs Java): `npm run test:rules`.

## Data layout

```
users/{uid}/ledger/settings   primary currency, currencies, manual rates, accounts, categories
users/{uid}/ledger/plan       budgets, goals, recurring income/bills, debts, guidance assumptions
users/{uid}/ledger/market     cached reference exchange rates (units per USD)
users/{uid}/months/{YYYY-MM}  { month, items: Transaction[] }, one document per month
```

Transactions are grouped by month so a month loads in one read and a year in twelve, which keeps reads well inside the free tier.

## Exchange rates

Rates are fetched automatically (at most every 12 hours) from [Frankfurter](https://frankfurter.dev) (European Central Bank reference rates, working days). Currencies the ECB doesn't publish (AED, LKR and others) come from [ExchangeRate-API](https://www.exchangerate-api.com)'s open endpoint. Any rate you type in Setup overrides the reference rate, and a rate entered on a transaction is locked to that transaction.

## Project structure

```
src/app/
  core/       pure, framework-free logic + unit tests (models, FX, summaries, budgets, goals, recurring, guidance, CSV)
  data/       Backend abstraction: FirebaseBackend, DemoBackend, RatesService
  state/      LedgerStore (NgRx Signal Store), UiState
  shared/     icons, charts, dialogs, toasts, export (CSV/PDF), actions
  forms/      transaction, account, category, budget, goal, recurring, debt, onboarding, CSV import
  features/   one lazy-loaded page per route
  shell/      layout, navigation, sign-in
```

**Adding a feature:** put calculations in `core/` with a spec next to them, persist through `LedgerStore` (add fields to `Settings` or `Plan`, or a new document id in `DocRef` and in `firestore.rules`), and add a page under `features/` plus a route in `app.routes.ts`.

## Scripts

| Command | |
|---|---|
| `npm start` | dev server |
| `npm test` | unit tests (Vitest) |
| `npm run test:rules` | Firestore security-rules tests on the emulator |
| `npm run emulators` | local Auth + Firestore emulators (set `useEmulators = true` in the config file) |
| `npm run deploy` | build and deploy hosting + rules |

Guidance in the app is educational, not financial advice.
