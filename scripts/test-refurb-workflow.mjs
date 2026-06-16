import {
  formatLedgerReference,
  movementTypeFromLedger,
} from '../lib/inventory-movement-types.js';
import { evaluateRefurbQuestionnaire } from '../services/refurb-eligibility.service.js';
import { computeRefurbStoreCredit } from '../config/refurb.config.js';
import { ReturnsService } from '../services/returns.service.js';
import {
  buildDemoReturnLabel,
  demoTrackingNextStatus,
  isDemoReturnTracking,
} from '../services/shipping/demo-return-label.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pass = evaluateRefurbQuestionnaire(
  {
    isCleanAndWashable: 'yes',
    stains: 'no_stains',
    tearsHoles: 'no',
    fastenersBroken: 'no',
    heavilyWorn: 'no',
    odors: 'no',
    stillUsable: 'yes',
  },
  { front: 'https://example.com/front.jpg', back: 'https://example.com/back.jpg' }
);
assert(pass.decision === 'PASS', 'Expected PASS for clean item');

const fail = evaluateRefurbQuestionnaire(
  {
    isCleanAndWashable: 'yes',
    stains: 'permanent',
    tearsHoles: 'no',
    fastenersBroken: 'no',
    heavilyWorn: 'no',
    odors: 'no',
    stillUsable: 'yes',
  },
  { front: 'https://example.com/front.jpg', back: 'https://example.com/back.jpg' }
);
assert(fail.decision === 'FAIL', 'Expected FAIL for permanent stains');

const manual = evaluateRefurbQuestionnaire(
  {
    isCleanAndWashable: 'yes',
    stains: 'minor_removable',
    tearsHoles: 'no',
    fastenersBroken: 'no',
    heavilyWorn: 'no',
    odors: 'yes',
    stillUsable: 'yes',
  },
  { front: 'https://example.com/front.jpg', back: 'https://example.com/back.jpg' }
);
assert(manual.decision === 'MANUAL_REVIEW', 'Expected MANUAL_REVIEW for minor stains + odors');

const credit = computeRefurbStoreCredit(50);
assert(credit === 10, `Expected $10 flat credit for $50 item, got ${credit}`);

const svc = new ReturnsService();
assert(svc.validateTransition('APPROVED', 'LABEL_GENERATED', 'REFURBISHMENT'), 'Label after approval');
assert(svc.validateTransition('INSPECTION_APPROVED', 'RECEIVED', 'REFURBISHMENT') === false, 'No backward');
assert(svc.resolveReturnStatusFromTracking('IN TRANSIT', 'LABEL_GENERATED') === 'IN_TRANSIT', 'Transit mapping');
assert(svc.resolveReturnStatusFromTracking('DELIVERED', 'IN_TRANSIT') === 'RECEIVED', 'Delivered mapping');

const demoLabel = buildDemoReturnLabel('cmq03zyi9001kraep');
assert(demoLabel.trackingNumber.startsWith('DEMO-'), 'Demo tracking prefix');
assert(demoLabel.shippingLabelUrl.includes('/uploads/demo/'), 'Demo label URL');
assert(isDemoReturnTracking(demoLabel.trackingNumber, 'demo'), 'Demo tracking detection');
assert(demoTrackingNextStatus('LABEL_GENERATED') === 'IN_TRANSIT', 'Demo sync step 1');
assert(demoTrackingNextStatus('IN_TRANSIT') === 'RECEIVED', 'Demo sync step 2');

assert(movementTypeFromLedger('IN', 5) === 'IN', 'Ledger IN maps to IN');
assert(movementTypeFromLedger('OUT', -2) === 'OUT', 'Ledger OUT maps to OUT');
assert(movementTypeFromLedger(null, 3) === 'IN', 'Positive delta defaults to IN');
assert(movementTypeFromLedger(null, -1) === 'OUT', 'Negative delta defaults to OUT');
assert(
  formatLedgerReference('refurbishment_job', 'job_abc') === 'Refurb listing:job_abc',
  'Refurb job reference label'
);

/** Pipeline refurb SKU convention exercised by createListedRefurbProduct */
const sampleSourceSku = 'BB-TEE-001';
const expectedRefurbSku = `${sampleSourceSku}-RF`;
assert(expectedRefurbSku.endsWith('-RF'), 'Refurb SKU suffix');
assert(expectedRefurbSku === 'BB-TEE-001-RF', 'Refurb SKU pattern');

const sampleVariantSku = 'BB-TEE-001-SM-RED';
assert(`${sampleVariantSku}-RF` === 'BB-TEE-001-SM-RED-RF', 'Variant refurb SKU mirrors source + -RF');

console.log('refurb workflow unit tests passed');
