import {
  ApplicationConfig,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideCopilotKit } from '@copilotkit/angular';
import { initSalesAgent } from './agents/sales/sales-agent';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideCopilotKit({
      enableInspector: true,
      defaultToolRendering: true,
    }),
    // We provide initSalesAgent but we could execute the function in lazy mode when a children is loaded.
    provideAppInitializer(initSalesAgent),

    // TODO #8a: provide initDashboardAgent
  ],
};
