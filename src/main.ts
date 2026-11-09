// Record Content-Security-Policy violations so the Setup → Connection check can show them.
const w = window as unknown as { __cspViolations: string[] };
w.__cspViolations = [];
document.addEventListener('securitypolicyviolation', (e) => {
  if (w.__cspViolations.length < 20) w.__cspViolations.push(`${e.effectiveDirective} blocked ${e.blockedURI || 'inline'}`);
});

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
