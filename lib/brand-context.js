import { mergeBrandContext } from '../../packages/brand/index.js';
import { config } from '../config/env.js';

/** Runtime brand context passed into all document templates. */
export function getBrandContext() {
  const logoUrl =
    config.publicBaseUrl && config.brand?.logoPath
      ? `${config.publicBaseUrl}${config.brand.logoPath}`
      : config.publicBaseUrl
        ? `${config.publicBaseUrl}/brand/logo-mark.svg`
        : null;

  return mergeBrandContext({
    storeUrl: config.storeUrl,
    customerUrl: config.frontend.customerUrl,
    adminUrl: config.frontend.adminUrl,
    supportEmail: config.brand?.supportEmail,
    logoUrl,
  });
}
