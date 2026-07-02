import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeSimpleToVariantMigration } from '../lib/simple-to-variant-migration.js';

describe('describeSimpleToVariantMigration', () => {
  it('marks legacy simple rows with canonical age as eligible', () => {
    const result = describeSimpleToVariantMigration({
      id: 1,
      sku: 'SKU-ABC',
      inventoryModel: 'simple',
      sizeAgeGroup: '6-9M',
      variants: [],
      sourceReturnId: null,
    });
    assert.equal(result.eligible, true);
    assert.equal(result.age, '6-9M');
  });

  it('skips products that already have variants', () => {
    const result = describeSimpleToVariantMigration({
      id: 2,
      sku: 'SKU-DEF',
      inventoryModel: 'variant_matrix',
      sizeAgeGroup: '6-9M',
      variants: [{ id: 10 }],
      sourceReturnId: null,
    });
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes('already_variant_matrix'));
  });

  it('skips pipeline refurb listings', () => {
    const result = describeSimpleToVariantMigration({
      id: 3,
      sku: 'SKU-GHI',
      inventoryModel: 'simple',
      sizeAgeGroup: '3-6M',
      variants: [],
      sourceReturnId: 99,
    });
    assert.equal(result.eligible, false);
    assert.ok(result.reasons.includes('pipeline_refurb_listing'));
  });
});
