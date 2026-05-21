import axios from 'axios';

function normalizeUpsError(error) {
  if (error?.response) {
    const d = error.response.data;
    const msg =
      d?.response?.errors?.[0]?.message ||
      d?.fault?.detail?.errors?.[0]?.message ||
      d?.message ||
      'UPS request failed';
    return {
      statusCode: Number(error.response.status) || 502,
      code: 'UPS_API_ERROR',
      message: msg,
      details: d,
    };
  }
  return { statusCode: 502, code: 'UPS_API_ERROR', message: error?.message || 'UPS request failed' };
}

function upsAddressLine(addr) {
  const line1 = String(addr.street1 || addr.addressLine1 || '').trim();
  const lines = [line1];
  const line2 = String(addr.street2 || addr.addressLine2 || '').trim();
  if (line2) lines.push(line2);
  return { AddressLine: lines };
}

function buildShopPayload({ from, to, parcel, accountNumber, packageType = '02' }) {
  const pkg = {
    PackagingType: { Code: packageType || '02' },
    Dimensions: {
      UnitOfMeasurement: { Code: parcel.distance_unit === 'cm' ? 'CM' : 'IN' },
      Length: String(parcel.length || '10'),
      Width: String(parcel.width || '8'),
      Height: String(parcel.height || '4'),
    },
    PackageWeight: {
      UnitOfMeasurement: { Code: parcel.mass_unit === 'kg' ? 'KGS' : 'LBS' },
      Weight: String(parcel.weight || '1'),
    },
  };

  return {
    RateRequest: {
      Request: {
        RequestOption: 'Shop',
        TransactionReference: { CustomerContext: 'BabyBarnRating' },
      },
      Shipment: {
        Shipper: {
          Name: String(from.name || 'Shipper').slice(0, 35),
          ShipperNumber: accountNumber,
          Address: {
            ...upsAddressLine(from),
            City: String(from.city || ''),
            StateProvinceCode: String(from.state || '').slice(0, 5),
            PostalCode: String(from.zip || '').replace(/\s/g, ''),
            CountryCode: String(from.country || 'US'),
          },
        },
        ShipFrom: {
          Name: String(from.name || 'ShipFrom').slice(0, 35),
          Address: {
            ...upsAddressLine(from),
            City: String(from.city || ''),
            StateProvinceCode: String(from.state || '').slice(0, 5),
            PostalCode: String(from.zip || '').replace(/\s/g, ''),
            CountryCode: String(from.country || 'US'),
          },
        },
        ShipTo: {
          Name: String(to.name || 'ShipTo').slice(0, 35),
          Address: {
            ...upsAddressLine(to),
            City: String(to.city || ''),
            StateProvinceCode: String(to.state || '').slice(0, 5),
            PostalCode: String(to.zip || '').replace(/\s/g, ''),
            CountryCode: String(to.country || 'US'),
          },
        },
        PaymentInformation: {
          ShipmentCharge: {
            Type: '01',
            BillShipper: { AccountNumber: accountNumber },
          },
        },
        NumOfPieces: '1',
        Package: pkg,
      },
    },
  };
}

export class UpsClient {
  constructor(opts = {}) {
    this.clientId = opts.clientId || process.env.UPS_CLIENT_ID || '';
    this.clientSecret = opts.clientSecret || process.env.UPS_CLIENT_SECRET || '';
    this.accountNumber = opts.accountNumber || process.env.UPS_ACCOUNT_NUMBER || '';
    this.baseUrl = (opts.baseUrl || process.env.UPS_API_BASE_URL || 'https://wwwcie.ups.com').replace(/\/$/, '');
    this.apiVersion = opts.apiVersion || process.env.UPS_RATING_VERSION || 'v2409';
    this.pickupType = String(opts.pickupType || process.env.UPS_PICKUP_TYPE || '01').trim();
    this.defaultPackageType = String(opts.defaultPackageType || process.env.UPS_DEFAULT_PACKAGE_TYPE || '02').trim();
    this.token = null;
    this.tokenExpiresAt = 0;
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: parseInt(process.env.UPS_TIMEOUT_MS || '20000', 10),
    });
  }

  hasCredentials() {
    return Boolean(
      String(this.clientId).trim() && String(this.clientSecret).trim() && String(this.accountNumber).trim()
    );
  }

  async getAccessToken() {
    const now = Date.now();
    if (this.token && this.tokenExpiresAt > now + 5000) return this.token;
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const { data } = await axios.post(
      `${this.baseUrl}/security/v1/oauth/token`,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'x-merchant-id': this.accountNumber,
        },
        timeout: 15000,
      }
    );
    this.token = data.access_token;
    this.tokenExpiresAt = now + (data.expires_in ? data.expires_in * 1000 : 3_600_000);
    return this.token;
  }

  async shopRate({ from, to, parcel }) {
    if (!this.hasCredentials()) {
      throw { statusCode: 503, code: 'UPS_NOT_CONFIGURED', message: 'UPS credentials are not configured' };
    }
    const token = await this.getAccessToken();
    const body = buildShopPayload({
      from,
      to,
      parcel,
      accountNumber: this.accountNumber,
      packageType: this.defaultPackageType,
    });
    const transId = `bb-${Date.now()}`;
    try {
      const { data } = await this.http.post(`/api/rating/${this.apiVersion}/Shop`, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          transId,
          transactionSrc: 'babybarn',
        },
      });
      return data;
    } catch (e) {
      throw normalizeUpsError(e);
    }
  }

  /**
   * Parse Shop response into list of { serviceCode, serviceName, totalCharges, currency }.
   */
  static parseShopRates(data) {
    const rated =
      data?.RateResponse?.RatedShipment ||
      data?.rateResponse?.ratedShipment ||
      data?.RatedShipment;
    const list = Array.isArray(rated) ? rated : rated ? [rated] : [];
    const out = [];
    for (const row of list) {
      const svc = row?.Service?.Code || row?.service?.code;
      if (!svc) continue;
      const charges =
        row?.TotalCharges?.MonetaryValue ||
        row?.totalCharges?.monetaryValue ||
        row?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue;
      const cur =
        row?.TotalCharges?.CurrencyCode ||
        row?.totalCharges?.currencyCode ||
        'USD';
      const name = row?.Service?.Description || row?.service?.description || `UPS ${svc}`;
      const amt = charges != null ? Number(charges) : NaN;
      if (!Number.isFinite(amt)) continue;
      out.push({
        serviceCode: String(svc),
        serviceName: String(name),
        totalCharges: amt,
        currency: String(cur || 'USD'),
        guaranteedDaysToDelivery: row?.GuaranteedDelivery?.BusinessDaysInTransit || null,
        raw: row,
      });
    }
    return out;
  }

  buildShipRequest({ from, to, parcel, serviceCode, description }) {
    const acct = String(this.accountNumber || '').trim();
    if (!acct) {
      throw { statusCode: 503, code: 'UPS_ACCOUNT_REQUIRED', message: 'UPS account number is required for labels' };
    }
    const phone = (p) => {
      let digits = String(p || '5555555555').replace(/\D/g, '');
      if (digits.length < 10) digits = '5555555555';
      return { Number: digits.slice(0, 15), Extension: ' ' };
    };
    const addr = (a) => ({
      ...upsAddressLine(a),
      City: String(a.city || ''),
      StateProvinceCode: String(a.state || '').slice(0, 5),
      PostalCode: String(a.zip || '').replace(/\s/g, ''),
      CountryCode: String(a.country || 'US').slice(0, 2).toUpperCase(),
    });
    const pkg = {
      Packaging: { Code: this.defaultPackageType || '02' },
      Dimensions: {
        UnitOfMeasurement: { Code: parcel.distance_unit === 'cm' ? 'CM' : 'IN' },
        Length: String(parcel.length || '10'),
        Width: String(parcel.width || '8'),
        Height: String(parcel.height || '4'),
      },
      PackageWeight: {
        UnitOfMeasurement: { Code: parcel.mass_unit === 'kg' ? 'KGS' : 'LBS' },
        Weight: String(parcel.weight || '1'),
      },
    };
    const fromName = String(from.name || 'Shipper').slice(0, 35);
    const toName = String(to.name || 'Recipient').slice(0, 35);
    return {
      ShipmentRequest: {
        Request: {
          RequestOption: 'nonvalidate',
          SubVersion: '1801',
          TransactionReference: { CustomerContext: 'BabyBarnShip' },
        },
        Shipment: {
          Description: String(description || 'Baby Barn shipment').slice(0, 50),
          Shipper: {
            Name: fromName,
            AttentionName: fromName,
            Phone: phone(from.phone),
            ShipperNumber: acct,
            Address: addr(from),
          },
          ShipFrom: {
            Name: fromName,
            Phone: phone(from.phone),
            Address: addr(from),
          },
          ShipTo: {
            Name: toName,
            AttentionName: toName,
            Phone: phone(to.phone),
            Address: addr(to),
            Residential: ' ',
          },
          PaymentInformation: {
            ShipmentCharge: { Type: '01', BillShipper: { AccountNumber: acct } },
          },
          Service: { Code: String(serviceCode), Description: 'Ship' },
          ...(this.pickupType
            ? { ShipmentServiceOptions: { PickupType: { Code: this.pickupType } } }
            : {}),
          Package: pkg,
        },
        LabelSpecification: {
          LabelImageFormat: { Code: 'GIF', Description: 'GIF' },
          HTTPUserAgent: 'Mozilla/4.5',
        },
      },
    };
  }

  async ship({ from, to, parcel, serviceCode, description }) {
    if (!this.hasCredentials()) {
      throw { statusCode: 503, code: 'UPS_NOT_CONFIGURED', message: 'UPS credentials are not configured' };
    }
    const token = await this.getAccessToken();
    const ver = process.env.UPS_SHIP_VERSION || 'v2409';
    const body = this.buildShipRequest({ from, to, parcel, serviceCode, description });
    const transId = `bb-${Date.now()}`.slice(0, 32);
    try {
      const { data } = await this.http.post(`/api/shipments/${ver}/ship`, body, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          transId,
          transactionSrc: 'babybarn',
        },
      });
      return data;
    } catch (e) {
      throw normalizeUpsError(e);
    }
  }

  static parseShipResponse(data) {
    const sr = data?.ShipmentResponse || data?.shipmentResponse;
    const results = sr?.ShipmentResults || sr?.shipmentResults;
    const ident = results?.ShipmentIdentificationNumber || results?.shipmentIdentificationNumber;
    let pkg = results?.PackageResults;
    const arr = Array.isArray(pkg) ? pkg : pkg ? [pkg] : [];
    const p0 = arr[0] || {};
    const label = p0.ShippingLabel || p0.shippingLabel || {};
    const graphic =
      label.GraphicImage ||
      label.graphicImage ||
      (Array.isArray(label.GraphicImagePart) ? label.GraphicImagePart.join('') : null);
    const digest = results?.ShipmentDigest || results?.shipmentDigest;
    return {
      trackingNumber: ident ? String(ident) : null,
      graphicImageBase64: graphic ? String(graphic) : null,
      shipmentDigest: digest ? String(digest) : null,
      identificationNumber: ident ? String(ident) : null,
      raw: data,
    };
  }

  async trackDetails(inquiryNumber) {
    if (!this.hasCredentials()) {
      throw { statusCode: 503, code: 'UPS_NOT_CONFIGURED', message: 'UPS credentials are not configured' };
    }
    const token = await this.getAccessToken();
    const tn = encodeURIComponent(String(inquiryNumber || '').trim());
    const transId = `bb-${Date.now()}`.slice(0, 32);
    try {
      const { data } = await this.http.get(`/api/track/v1/details/${tn}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          transId,
          transactionSrc: 'babybarn',
        },
        params: { locale: 'en_US' },
      });
      return data;
    } catch (e) {
      throw normalizeUpsError(e);
    }
  }

  static parseTrackResponse(data) {
    const tr = data?.trackResponse || data?.TrackResponse;
    const ship = tr?.shipment?.[0] || tr?.Shipment?.[0] || tr?.shipment || tr?.Shipment;
    const pkg = ship?.package?.[0] || ship?.Package?.[0] || ship?.package || ship?.Package;
    const activities = pkg?.activity || pkg?.Activity || [];
    const list = Array.isArray(activities) ? activities : activities ? [activities] : [];
    const history = list.map((a) => ({
      status: a?.status?.description || a?.Status?.Description || a?.status?.type || a?.Status?.Type,
      status_details: a?.status?.description || a?.Status?.Description,
      status_date: a?.date || a?.Date || a?.gmtDate || a?.GMTDate,
      location: {
        city: a?.location?.address?.city || a?.Location?.Address?.city,
        state: a?.location?.address?.stateProvince || a?.Location?.Address?.StateProvinceCode,
        country: a?.location?.address?.countryCode || a?.Location?.Address?.CountryCode,
      },
    }));
    const current =
      pkg?.currentStatus?.description ||
      pkg?.packageAddress?.status?.description ||
      list[0]?.status?.description ||
      'UNKNOWN';
    const eta =
      pkg?.deliveryDate?.[0]?.date ||
      pkg?.deliveryTime?.endTime ||
      pkg?.packageServiceOptions?.estDeliveryDate ||
      null;
    return {
      status: String(current || 'UNKNOWN'),
      statusDetails: String(pkg?.currentStatus?.description || ''),
      statusDate: list[0]?.date || list[0]?.Date || null,
      eta,
      history,
      raw: data,
    };
  }
}
