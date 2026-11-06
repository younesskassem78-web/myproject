import { registerLocaleData } from '@angular/common';
import localeAr from '@angular/common/locales/ar';
import localeFr from '@angular/common/locales/fr';
import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withViewTransitions } from '@angular/router';
import { authInterceptor } from './core/auth';
import { resilienceInterceptor } from './core/resilience';
import { routes } from './app.routes';
import { LANG, LOCALE, RTL } from './core/i18n';

registerLocaleData(localeAr);
registerLocaleData(localeFr);
document.documentElement.lang = LANG;
document.documentElement.dir = RTL ? 'rtl' : 'ltr';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }), withComponentInputBinding(),
      withViewTransitions({ skipInitialTransition: true })), // pages cross-fade; off for reduced motion (styles.scss)
    provideHttpClient(withInterceptors([authInterceptor, resilienceInterceptor])),
    { provide: LOCALE_ID, useValue: LOCALE }, // dates and amounts follow the chosen language
  ],
};
