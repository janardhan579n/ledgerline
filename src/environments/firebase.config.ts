/**
 * Paste your Firebase web app config here (Firebase console → Project settings → Your apps → Web app).
 * These values identify your project; they are not secrets. Access to data is enforced by firestore.rules.
 *
 * While projectId is empty the app runs in demo mode: no sign-in, data kept in memory only.
 */
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};

/** Set to true to point the app at the local Firebase emulators (npm run emulators). */
export const useEmulators = false;

export const isFirebaseConfigured = () => !!firebaseConfig.projectId && !!firebaseConfig.apiKey;
