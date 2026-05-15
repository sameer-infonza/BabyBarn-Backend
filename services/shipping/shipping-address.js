export function normalizeCountry(country) {
  const c = String(country || '').trim().toUpperCase();
  if (!c) return 'US';
  if (['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA'].includes(c)) return 'US';
  if (['CA', 'CAN', 'CANADA'].includes(c)) return 'CA';
  return c;
}

export function normalizePostalCode(zip, countryCode) {
  const raw = String(zip || '').trim();
  if (!raw) return '';
  if (countryCode === 'US') {
    const digits = raw.replace(/[^\d-]/g, '');
    return digits.slice(0, 10);
  }
  if (countryCode === 'CA') {
    return raw.toUpperCase().replace(/\s+/g, '').replace(/(.{3})/, '$1 ').trim();
  }
  return raw;
}

export function normalizeState(state, countryCode) {
  const s = String(state || '').trim();
  if (!s) return '';
  if (countryCode === 'US' || countryCode === 'CA') return s.toUpperCase();
  return s;
}

export function toShippoAddress(address = {}) {
  const country = normalizeCountry(address.country);
  return {
    name: String(address.fullName || address.name || '').trim() || 'Recipient',
    street1: String(address.addressLine1 || address.street1 || '').trim(),
    street2: String(address.addressLine2 || address.street2 || '').trim() || undefined,
    city: String(address.city || '').trim(),
    state: normalizeState(address.state, country),
    zip: normalizePostalCode(address.zipCode || address.zip, country),
    country,
    phone: String(address.phoneNumber || address.phone || '').trim() || undefined,
    email: String(address.email || '').trim() || undefined,
    validate: false,
  };
}

export function defaultFromAddress() {
  return {
    name: String(process.env.SHIP_FROM_NAME || 'Baby Barn Warehouse').trim(),
    company: String(process.env.SHIP_FROM_COMPANY || 'Baby Barn').trim(),
    street1: String(process.env.SHIP_FROM_STREET1 || '').trim(),
    street2: String(process.env.SHIP_FROM_STREET2 || '').trim() || undefined,
    city: String(process.env.SHIP_FROM_CITY || '').trim(),
    state: String(process.env.SHIP_FROM_STATE || '').trim(),
    zip: String(process.env.SHIP_FROM_ZIP || '').trim(),
    country: String(process.env.SHIP_FROM_COUNTRY || 'US').trim(),
    phone: String(process.env.SHIP_FROM_PHONE || '').trim() || undefined,
    email: String(process.env.SHIP_FROM_EMAIL || '').trim() || undefined,
    validate: false,
  };
}

export function hasCompleteAddress(address) {
  return Boolean(
    address &&
      String(address.street1 || '').trim() &&
      String(address.city || '').trim() &&
      String(address.state || '').trim() &&
      String(address.zip || '').trim() &&
      String(address.country || '').trim()
  );
}

export function sanitizeParcel(p) {
  return {
    length: String(p.length),
    width: String(p.width),
    height: String(p.height),
    weight: String(p.weight),
    distance_unit: String(p.distance_unit || process.env.SHIP_DEFAULT_DISTANCE_UNIT || 'in'),
    mass_unit: String(p.mass_unit || process.env.SHIP_DEFAULT_MASS_UNIT || 'lb'),
  };
}

export function defaultParcel() {
  return {
    length: String(process.env.SHIP_DEFAULT_PARCEL_LENGTH || '10'),
    width: String(process.env.SHIP_DEFAULT_PARCEL_WIDTH || '8'),
    height: String(process.env.SHIP_DEFAULT_PARCEL_HEIGHT || '4'),
    distance_unit: String(process.env.SHIP_DEFAULT_DISTANCE_UNIT || 'in'),
    weight: String(process.env.SHIP_DEFAULT_WEIGHT || '1'),
    mass_unit: String(process.env.SHIP_DEFAULT_MASS_UNIT || 'lb'),
  };
}

export function dummyAddress(countryCode = 'US') {
  const c = normalizeCountry(countryCode);
  if (c === 'CA') {
    return {
      name: 'Dummy Receiver',
      street1: '111 Richmond St W',
      city: 'Toronto',
      state: 'ON',
      zip: 'M5H 2G4',
      country: 'CA',
      phone: '+14165550123',
      email: 'dummy.ca@example.com',
      validate: false,
    };
  }
  return {
    name: 'Dummy Receiver',
    street1: '1600 Amphitheatre Pkwy',
    city: 'Mountain View',
    state: 'CA',
    zip: '94043',
    country: 'US',
    phone: '+16505550123',
    email: 'dummy.us@example.com',
    validate: false,
  };
}
