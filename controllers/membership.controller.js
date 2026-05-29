import { validate } from '../utils/validation.js';
import { membershipRegistrationSchema } from '../schemas/index.js';
import {
  listMembershipPaymentsForUser,
  getAccessSavingsForUser,
  saveMembershipRegistration,
} from '../services/membership.service.js';
import { getMembershipEligibilityForUser } from '../services/membership-eligibility.service.js';
import { toPublicJson } from '../utils/serialize.js';

export async function saveRegistration(req, res, next) {
  try {
    const body = await validate(membershipRegistrationSchema, req.body);
    const data = await saveMembershipRegistration(req.user.id, body);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  } catch (e) {
    return next(e);
  }
}

export async function getPaymentHistory(req, res, next) {
  try {
    const data = await listMembershipPaymentsForUser(req.user.id);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  } catch (e) {
    next(e);
  }
}

export async function getSavings(req, res, next) {
  try {
    const data = await getAccessSavingsForUser(req.user.id);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  } catch (e) {
    next(e);
  }
}

export async function getEligibility(req, res, next) {
  try {
    const data = await getMembershipEligibilityForUser(req.user.id);
    res.status(200).json({ success: true, data: toPublicJson(data) });
  } catch (e) {
    next(e);
  }
}
