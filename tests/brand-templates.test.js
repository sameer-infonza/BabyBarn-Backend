import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderBrandedEmailTemplate } from '../../packages/brand/email/templates.js';
import { mergeBrandContext } from '../../packages/brand/lib/tokens.js';

const brand = mergeBrandContext({
  storeUrl: 'https://babybarn.co',
  customerUrl: 'https://babybarn.co',
  adminUrl: 'https://admin.babybarn.co',
});

const ALL_TEMPLATES = [
  'verify-email',
  'forgot-password',
  'welcome',
  'otp',
  'order-confirmation',
  'order-tracking',
  'order-cancelled',
  'refund-confirmation',
  'return-status',
  'store-credit-update',
  'access-purchase',
  'access-renewal',
  'access-renewal-reminder',
  'access-expired',
  'team-invite',
  'contact-inquiry-admin',
];

describe('brand email templates', () => {
  for (const template of ALL_TEMPLATES) {
    it(`renders ${template} with branded layout`, () => {
      const ctx = {
        name: 'Test User',
        actionUrl: 'https://babybarn.co/dashboard',
        orderId: 'BB-000001',
        total: '$50.00',
        subtotal: '$45.00',
        shipping: '$5.00',
        lines: [{ name: 'Onesie', qty: 1, total: '$45.00' }],
        trackingNumber: '1Z999',
        carrier: 'UPS',
        status: 'APPROVED',
        amount: '$10.00',
        accessNumber: 'ACC-123',
        validUntil: 'Jan 1, 2027',
        otp: '123456',
        minutes: 10,
        email: 'team@babybarn.co',
        temporaryPassword: 'temp-pass',
        roleTitle: 'Fulfillment',
        loginUrl: 'https://admin.babybarn.co/login',
        fromName: 'Jane',
        fromEmail: 'jane@example.com',
        subjectLine: 'Question',
        message: 'Hello team',
        plainText: 'plain',
      };
      const { subject, html, text } = renderBrandedEmailTemplate(template, ctx, brand);
      assert.ok(subject.length > 3);
      assert.ok(html.includes('Baby Barn'));
      assert.ok(
        html.includes('#49297e') || html.includes('#00db96') || html.includes('#4A7C59')
      );
      assert.ok(html.includes('hello@babybarn.co') || html.includes('babybarn.co'));
      assert.equal(typeof text, 'string');
    });
  }
});
