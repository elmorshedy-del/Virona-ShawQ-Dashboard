const FALLBACK_REGION_CODES = [
  'AF','AX','AL','DZ','AS','AD','AO','AI','AQ','AG','AR','AM','AW','AU','AT','AZ','BS','BH','BD','BB','BY','BE','BZ','BJ','BM','BT','BO','BQ','BA','BW','BV','BR','IO','BN','BG','BF','BI','CV','KH','CM','CA','KY','CF','TD','CL','CN','CX','CC','CO','KM','CG','CD','CK','CR','CI','HR','CU','CW','CY','CZ','DK','DJ','DM','DO','EC','EG','SV','GQ','ER','EE','SZ','ET','FK','FO','FJ','FI','FR','GF','PF','TF','GA','GM','GE','DE','GH','GI','GR','GL','GD','GP','GU','GT','GG','GN','GW','GY','HT','HM','VA','HN','HK','HU','IS','IN','ID','IR','IQ','IE','IM','IL','IT','JM','JP','JE','JO','KZ','KE','KI','KP','KR','KW','KG','LA','LV','LB','LS','LR','LY','LI','LT','LU','MO','MG','MW','MY','MV','ML','MT','MH','MQ','MR','MU','YT','MX','FM','MD','MC','MN','ME','MS','MA','MZ','MM','NA','NR','NP','NL','NC','NZ','NI','NE','NG','NU','NF','MK','MP','NO','OM','PK','PW','PS','PA','PG','PY','PE','PH','PN','PL','PT','PR','QA','RE','RO','RU','RW','BL','SH','KN','LC','MF','PM','VC','WS','SM','ST','SA','SN','RS','SC','SL','SG','SX','SK','SI','SB','SO','ZA','GS','SS','ES','LK','SD','SR','SJ','SE','CH','SY','TW','TJ','TZ','TH','TL','TG','TK','TO','TT','TN','TR','TM','TC','TV','UG','UA','AE','GB','US','UM','UY','UZ','VU','VE','VN','VG','VI','WF','EH','YE','ZM','ZW'
];

function countryCodeToFlag(code) {
  if (!/^[A-Z]{2}$/.test(code)) return '🏳️';
  const codePoints = [...code].map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function resolveRegionCodes() {
  return FALLBACK_REGION_CODES;
}

function resolveDisplayNames() {
  if (typeof Intl.DisplayNames === 'function') {
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' });
    } catch (error) {
      return null;
    }
  }
  return null;
}

const REGION_CODES = resolveRegionCodes();
const displayNames = resolveDisplayNames();

const ALL_COUNTRIES = REGION_CODES.map(code => ({
  code,
  name: displayNames ? displayNames.of(code) : code,
  flag: countryCodeToFlag(code)
})).sort((a, b) => a.name.localeCompare(b.name));

export function getAllCountries() {
  return ALL_COUNTRIES;
}

export function getCountryInfo(code) {
  const upperCode = (code || '').toUpperCase();
  return ALL_COUNTRIES.find(c => c.code === upperCode) || { code: upperCode, name: code, flag: '🏳️' };
}
