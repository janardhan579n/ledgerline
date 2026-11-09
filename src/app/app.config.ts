import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { isFirebaseConfigured } from '../environments/firebase.config';
import { routes } from './app.routes';
import { Backend } from './data/backend';
import { DemoBackend } from './data/demo-backend';
import { FirebaseBackend } from './data/firebase-backend';
import { GeminiReader } from './data/gemini-reader';
import { DemoReader, ReceiptReader } from './data/receipt-reader';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    { provide: Backend, useClass: isFirebaseConfigured() ? FirebaseBackend : DemoBackend },
    { provide: ReceiptReader, useClass: isFirebaseConfigured() ? GeminiReader : DemoReader },
    // The service worker fetches every request the page makes, under the CSP it was installed with, so its
    // connect-src must cover all outside hosts the page loads from. Bump ?v= whenever firebase.json's CSP
    // changes: the new URL makes browsers install a fresh worker with the new policy.
    provideServiceWorker('ngsw-worker.js?v=2', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' }),
  ],
};
