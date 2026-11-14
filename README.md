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

### Who can use it: the first 5 Google accounts

The first 5 Google accounts to sign in each get a seat; the 6th and later see "all places are taken" and can't read or write anything.
Each person only ever sees their own data. The owner (the email in `isAdmin()` in `firestore.rules`) always keeps access.
The limit is enforced by the security rules (`members/{uid}` and `seats/1..5`), not just the app.

To free a seat for someone else, open Firebase console → Firestore and delete both `members/{their uid}` and `seats/{n}` for that person.
To change the number of seats, edit the `['1', '2', '3', '4', '5']` lists in `firestore.rules` and `SEATS` in `src/app/data/firebase-backend.ts`, then run `npm run deploy:rules`.
Everyone shares the free AI scanning quota.

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

## Prices

Prices (in the menu) shows gold (24K/22K/18K, per gram, 10 g, ounce or kg), silver and any currency pair
(for example 1 MYR in INR). Press **Get latest prices** to fetch them. Add the ones you care about to your list,
optionally with a target (above or below a price); the list shows "Target reached" when the price gets there.
Prices are international spot prices from [xaus.com](https://xaus.com/api) (gold, silver) and
[open.er-api.com](https://open.er-api.com) (currencies); shop and bank prices add a premium.

### Price notifications (built, switched off for now)

The code for notifications is in place but disabled: daily updates and above/below/percentage alerts sent by ntfy
or browser push, from an hourly GitHub Actions job (`scripts/price-alerts/run.ts`).
To turn it on: set `NOTIFICATIONS_ENABLED = true` in `src/app/core/price-alerts.ts`, copy
`scripts/price-alerts/workflow.yml` to `.github/workflows/price-alerts.yml` and uncomment its schedule
(see the comment at the top of that file), then do the setup below. Hourly runs use about 720 of the 2,000 free GitHub Actions
minutes a month for a private repo.

#### Setup when turning notifications on

1. **Let the job read alerts.** Firebase console → Project settings → Service accounts → *Generate new private key*.
   Open the downloaded file, copy all of it, then on GitHub: repo → Settings → Secrets and variables → Actions →
   *New repository secret*, name `FIREBASE_SERVICE_ACCOUNT`, paste, save. Delete the downloaded file afterwards;
   it's a full-access key and must never be committed.
2. **Phone push (ntfy).** In the app, turn on *Phone push with the ntfy app*, install ntfy, subscribe to the topic shown,
   and press *Send a test*.
3. **Browser push (optional).** Firebase console → Project settings → Cloud Messaging → Web configuration →
   Web Push certificates → *Generate key pair*. Copy the key into `pushConfig.vapidKey` in
   `src/environments/firebase.config.ts`, build and deploy, then turn on *Notifications on this device* in each browser.
   On iPhone/iPad, add Ledgerline to the Home Screen first and open it from there.
   If your browser API key has an API restriction list, also allow *Firebase Installations API* and *FCM Registration API*.
4. **Check it.** GitHub → Actions → *Price alerts* → *Run workflow* (tick *dry run* to only print what would be sent).
   The Price alerts page shows when the job last checked and any problem it hit.

## Loans & EMIs

Loans & EMIs (in the menu) tracks each loan from a few details: the monthly EMI, the EMI date and how many EMIs are left.
Add one more detail to see the interest: the interest rate, the outstanding principal (the rate is worked out),
or the original amount and tenure (the rate is worked out). Without any of them you still see the total left to pay.

For each loan: total still to pay, principal vs interest, next EMI and its interest/principal split, last EMI date,
progress and interest paid so far (when the original amount and tenure are known), a year-by-year repayment schedule,
and a prepayment what-if (one-time amount and/or extra each month; keep the EMI and finish sooner, or keep the end date
and lower the EMI). Totals are kept separate per currency (for example INR loans and MYR loans), never mixed;
only the EMIs-vs-income share converts to your main currency.

Choose Flat rate for car hire purchase and card instalment plans quoted that way (same interest every month on the original amount;
early settlement is estimated with the Rule of 78). The form warns when the numbers you enter don't fit together or give an
unusually high rate. Figures roll forward on their own as EMI dates pass. Optionally the EMI is added to scheduled payments
(it stops after the last EMI and can be recorded automatically as "Loan & card payments").
Loan balances also feed the Guidance page. Calculations assume a fixed rate on a reducing balance.

## Batch upload from a template

Transactions → **Batch upload** (or Setup → Import & export).

1. **Download template (.xlsx)** builds an Excel file on your device with a Transactions sheet,
   dropdowns filled from your own accounts, categories, currencies and goals (Lists sheet),
   and an Instructions sheet with every column explained and worked examples.
2. Fill one transaction per row (Excel, Numbers, Google Sheets or LibreOffice; CSV with the same headers also works).
3. Upload it. Every row is checked before anything is saved: dates, types, amounts, currencies,
   categories for the row's type, accounts, transfers, goals and likely duplicates.
   Rows with problems show the reason next to each field and can be edited on screen.
   Fixing a value offers to apply the same fix to other rows with the same mistake.
4. **Download rows to fix** gives a CSV of the rows that still have problems (with a Problems column).
   Fix it and upload it again; the extra columns are ignored.
5. After importing, **Undo this import** removes everything from that upload.

Files are read in the browser; only the rows you import are saved. Limits: 5 MB and 2,000 rows per file.

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
  core/       pure, framework-free logic + unit tests (models, FX, summaries, budgets, goals, recurring, guidance, CSV, batch template validation, .xlsx reader)
  data/       Backend abstraction: FirebaseBackend, DemoBackend, RatesService
  state/      LedgerStore (NgRx Signal Store), UiState
  shared/     icons, charts, dialogs, toasts, export (CSV/PDF), actions
  forms/      transaction, account, category, budget, goal, recurring, debt, onboarding, CSV import, batch upload
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
