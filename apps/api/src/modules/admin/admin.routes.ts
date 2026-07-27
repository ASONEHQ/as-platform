import type { FastifyInstance } from 'fastify';

import { registerBranchRoutes } from './branches/branches.routes.js';
import { registerCompanyRoutes } from './companies/companies.routes.js';
import { registerContextRoutes } from './context/context.routes.js';
import { registerDeviceRoutes } from './devices/devices.routes.js';
import { registerIdentityAdministrationRoutes } from './identity/identity.routes.js';
import { registerSettingsRoutes } from './settings/settings.routes.js';
import type { AuthService } from '../auth/auth.service.js';
import type { AdministrationService } from './shared/admin.service.js';
import type { SettingsService } from './settings/settings.service.js';

/** Registers the administration surface only after database-backed authentication is available. */
export function registerAdministrationRoutes(
  app: FastifyInstance,
  authentication: AuthService,
  administration: AdministrationService,
  settings: SettingsService,
): void {
  registerContextRoutes(app, authentication, administration);
  registerCompanyRoutes(app, authentication, administration);
  registerBranchRoutes(app, authentication, administration);
  registerIdentityAdministrationRoutes(app, authentication, administration);
  registerDeviceRoutes(app, authentication, administration);
  registerSettingsRoutes(app, authentication, settings);
}
