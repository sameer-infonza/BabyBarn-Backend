import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderBrandedEmailTemplate } from '@babybarn/brand';
import { mergeBrandContext } from '@babybarn/brand/tokens';

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
  'back-in-stock',
  'price-drop',
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
        lines: [
          {
            name: 'Organic Onesie',
            meta: 'SKU ON-01 · New · ACCESS price',
            qty: 1,
            unitPrice: '$45.00',
            amount: '$45.00',
            total: '$45.00',
          },
        ],
        issueDate: 'Aug 3, 2026',
        paymentStatus: 'Paid',
        orderStatus: 'Confirmed',
        billToLines: ['Test User', 'test@example.com', '123 Main St', 'Austin, TX 78701'],
        shipToLines: ['Test User', '123 Main St', 'Austin, TX 78701'],
        paymentMethod: 'Visa ending 4242',
        shippingMethod: 'UPS Ground',
        tax: '$2.70',
        storeCredit: null,
        accessMembership: null,
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
      if (template === 'order-confirmation') {
        assert.ok(html.includes('Invoice'));
        assert.ok(html.includes('Organic Onesie'));
        assert.ok(html.includes('Billed to'));
        assert.ok(html.includes('Ship to'));
        assert.ok(html.includes('Total paid'));
        assert.ok(html.includes('Visa ending 4242'));
        assert.ok(subject.toLowerCase().includes('invoice') || subject.toLowerCase().includes('confirmed'));
      }
    });
  }
});
