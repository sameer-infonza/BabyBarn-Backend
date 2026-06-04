/**
 * Transactional email rendering — delegates to @babybarn/brand design system.
 * @deprecated Import renderBrandedEmailTemplate from packages/brand in new code.
 */
import { renderBrandedEmailTemplate } from '../../packages/brand/index.js';
import { getBrandContext } from '../lib/brand-context.js';

export function renderEmailTemplate(template, context) {
  const brand = getBrandContext();
  return renderBrandedEmailTemplate(template, context, brand);
}

export { renderBrandedEmailTemplate };
