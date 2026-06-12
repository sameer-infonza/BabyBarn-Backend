import { evaluateRefurbQuestionnaire } from '../services/refurb-eligibility.service.js';

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

console.log('refurb-eligibility tests passed');
