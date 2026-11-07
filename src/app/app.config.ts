import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { isFirebaseConfigured } from '../environments/firebase.config';
import { routes } from './app.routes';
import { Backend } from './data/backend';
import { DemoBackend } from './data/demo-backend';
import { FirebaseBackend } from './data/firebase-backend';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    { provide: Backend, useClass: isFirebaseConfigured() ? FirebaseBackend : DemoBackend },
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' }),
  ],
};
