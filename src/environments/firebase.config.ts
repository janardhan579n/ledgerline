/**
 * Paste your Firebase web app config here (Firebase console → Project settings → Your apps → Web app).
 * These values identify your project; they are not secrets. Access to data is enforced by firestore.rules.
 *
 * While projectId is empty the app runs in demo mode: no sign-in, data kept in memory only.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyD-4ikmIQiZdFmwlVGcY6UkxXo4Z9La6JQ',
  authDomain: 'ledgerline-4e2d3.firebaseapp.com',
  projectId: 'ledgerline-4e2d3',
  storageBucket: 'ledgerline-4e2d3.firebasestorage.app',
  messagingSenderId: '887885056752',
  appId: '1:887885056752:web:857a6da0565af806415035',
};

/**
 * Receipt and payslip scanning (Firebase AI Logic → Gemini Developer API).
 * Turn it on once in the Firebase console: AI Services → AI Logic → Get started → Gemini Developer API.
 * Models are tried in order; if one isn't available to your project the next is used.
 * appCheckSiteKey: optional reCAPTCHA Enterprise (Google Cloud Fraud Defense) website key. When set, only your hosted app can use your AI quota (see README).
 */
export const aiConfig = {
  models: ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-flash'],
  appCheckSiteKey: '6LezbhcuAAAAAPkp75ZtmJ3YejJN37As2cD0wAUX',
};

/** Set to true to point the app at the local Firebase emulators (npm run emulators). */
/**
 * Browser push for price alerts. Paste the "Web Push certificates" key pair (public key) from
 * Firebase console → Project settings → Cloud Messaging. Leave empty to turn browser push off.
 */
export const pushConfig = { vapidKey: '' };
export const useEmulators = false;

export const isFirebaseConfigured = () => !!firebaseConfig.projectId && !!firebaseConfig.apiKey;
