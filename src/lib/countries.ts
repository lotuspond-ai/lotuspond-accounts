// Which data-residency cell holds a person's account, from their country of residence. The same rule as LotusPond
// Health (shared/regions.ts there), so an account and its Health records live in the same region.
import type { Region } from '../config.ts';

export const COUNTRY_CODES: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ');

const EU = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO AX GF GP MQ RE YT MF BL PM GB GG JE IM CH'.split(' '));
const US = new Set('US PR GU VI AS MP UM CA'.split(' '));

export const isCountryCode = (code: string): boolean => COUNTRY_CODES.includes(code);

export function regionFor(code: string): Region {
  if (code === 'IN') return 'in';
  if (EU.has(code)) return 'eu';
  if (US.has(code)) return 'us';
  return 'global';
}

const names = new Intl.DisplayNames(['en'], { type: 'region' });
export const countryName = (code: string): string => names.of(code) ?? code;
