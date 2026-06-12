/**
 * Auto-eligibility rules for refurbishment return questionnaires.
 */

const AUTO_REJECT_REASONS = {
  PERMANENT_STAINS: 'Product has permanent stains',
  TEARS_OR_HOLES: 'Product has tears, cuts, or holes',
  BROKEN_FASTENERS: 'Buttons, zippers, or fasteners are missing or broken',
  HEAVILY_WORN: 'Product is heavily worn or damaged',
  NOT_USABLE: 'Product is not functional or usable',
  PHOTOS_MISSING: 'Required photos were not provided',
};

const MANUAL_REVIEW_REASONS = {
  MINOR_STAINS: 'Minor removable stains — manual review required',
  ODORS: 'Product may require special odor treatment',
};

export function evaluateRefurbQuestionnaire(answers = {}, photoUrls = {}) {
  const reasons = [];
  const photos = photoUrls && typeof photoUrls === 'object' ? photoUrls : {};
  const hasFront = Boolean(photos.front);
  const hasBack = Boolean(photos.back);
  const hasDefect = Boolean(photos.defect);

  if (!hasFront || !hasBack) {
    reasons.push(AUTO_REJECT_REASONS.PHOTOS_MISSING);
  }

  if (answers.stains === 'permanent') {
    reasons.push(AUTO_REJECT_REASONS.PERMANENT_STAINS);
  }
  if (answers.tearsHoles === 'yes') {
    reasons.push(AUTO_REJECT_REASONS.TEARS_OR_HOLES);
  }
  if (answers.fastenersBroken === 'yes') {
    reasons.push(AUTO_REJECT_REASONS.BROKEN_FASTENERS);
  }
  if (answers.heavilyWorn === 'yes') {
    reasons.push(AUTO_REJECT_REASONS.HEAVILY_WORN);
  }
  if (answers.stillUsable === 'no') {
    reasons.push(AUTO_REJECT_REASONS.NOT_USABLE);
  }

  const hardFails = reasons.filter((r) => r !== AUTO_REJECT_REASONS.PHOTOS_MISSING);
  if (hardFails.length > 0 || reasons.includes(AUTO_REJECT_REASONS.PHOTOS_MISSING)) {
    return { decision: 'FAIL', reasons };
  }

  const manualReasons = [];
  if (answers.stains === 'minor_removable') {
    manualReasons.push(MANUAL_REVIEW_REASONS.MINOR_STAINS);
  }
  if (answers.odors === 'yes') {
    manualReasons.push(MANUAL_REVIEW_REASONS.ODORS);
  }
  if (answers.isCleanAndWashable === 'no') {
    manualReasons.push('Product may not be clean/washable — manual review required');
  }
  if (!hasDefect && (answers.stains !== 'no_stains' || answers.tearsHoles === 'yes')) {
    manualReasons.push('Defect close-up photo recommended — manual review');
  }

  if (manualReasons.length > 0) {
    return { decision: 'MANUAL_REVIEW', reasons: manualReasons };
  }

  return { decision: 'PASS', reasons: ['Meets automatic eligibility criteria'] };
}

export function initialReturnStatusForDecision(decision) {
  if (decision === 'FAIL') return 'ELIGIBILITY_REJECTED';
  if (decision === 'MANUAL_REVIEW') return 'ELIGIBILITY_REVIEW';
  return 'APPROVED';
}
