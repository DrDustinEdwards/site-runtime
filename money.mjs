/**
 * Money for display and for form inputs: one formatter for every site, server and browser alike (no DOM, no Node).
 *
 * Amounts are stored as integers in a small unit and only turned into a currency string for display. The unit is the
 * currency's minor unit by default, the one Stripe sends (https://docs.stripe.com/currencies, "Specify amounts in API
 * requests"), and that is not always a hundredth: for Stripe's zero-decimal currencies the amount is the whole unit
 * (5000 JPY is 5,000 yen) and for its three-decimal ones it is a thousandth. Dividing everything by 100 showed a
 * 5,000 yen dispute as 50 yen in Recova; `currencyExponent` is the one table that decides it.
 *
 * A site that stores some other unit says so with `scale`, the power of ten between its stored integer and the whole
 * unit: 3 for mills (Carrel's X budget), 6 for micros (Carrel's API cap), 0 for a whole-unit number.
 *
 * Intl.NumberFormat does the words, symbol and grouping, in American English (the network's), and a formatter is made
 * once per currency and digit count. A code Intl refuses still prints ("50.00 XYZ"), never throws on a page or in an
 * email.
 */

/**
 * Stripe's zero-decimal currencies: the amount is the whole unit (docs.stripe.com/currencies, "Zero-decimal
 * currencies"). UGX is left out on purpose: Stripe's "Special cases" say UGX "transitioned to a zero-decimal currency,
 * but backwards compatibility requires you to represent it as a two-decimal value", so 500 is 5 UGX.
 */
const ZERO_DECIMAL = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

/** Stripe's three-decimal currencies: the amount is in thousandths (and Stripe requires it to be divisible by 10). */
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

/**
 * Currencies Stripe sends as two-decimal values whose decimals are always 00 (Stripe's "Special cases": ISK and UGX).
 * Divided by 100 like any other, shown without the decimals that cannot exist.
 */
const WHOLE_UNITS_SENT_AS_HUNDREDTHS = new Set(["isk", "ugx"]);

/**
 * The power of ten between a currency's minor unit and its whole unit: 0 for JPY, 3 for KWD, 2 for everything else,
 * including a code nobody recognizes (the commonest case).
 * @param {string} currency an ISO 4217 code, either case
 * @returns {0 | 2 | 3}
 */
export function currencyExponent(currency) {
  const code = currency.toLowerCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/**
 * Decimal places a display of this currency carries: its exponent, except none for ISK and UGX.
 * @param {string} currency
 */
export function currencyDigits(currency) {
  return WHOLE_UNITS_SENT_AS_HUNDREDTHS.has(currency.toLowerCase())
    ? 0
    : currencyExponent(currency);
}

/**
 * @param {string} currency
 * @param {{ scale?: number } | undefined} options
 */
function scaleOf(currency, options) {
  return options?.scale ?? currencyExponent(currency);
}

/**
 * A stored amount in whole units of its currency: 5000 JPY is 5000, 5000 USD is 50, 5000 KWD is 5. For charts and
 * exports that need the number.
 * @param {number} amount
 * @param {string} currency
 * @param {{ scale?: number }} [options]
 */
export function toMajorUnits(amount, currency, options) {
  return amount / 10 ** scaleOf(currency, options);
}

/**
 * The inverse, rounded to a whole stored unit: a chart value or a typed figure back into the stored integer.
 * @param {number} major
 * @param {string} currency
 * @param {{ scale?: number }} [options]
 */
export function fromMajorUnits(major, currency, options) {
  return Math.round(major * 10 ** scaleOf(currency, options));
}

/** @type {Map<string, Intl.NumberFormat | null>} */
const FORMATS = new Map();

/**
 * One formatter per currency and digit count, or null when Intl refuses the code.
 * @param {string} code upper case
 * @param {number} digits
 */
function formatter(code, digits) {
  const key = `${code}|${digits}`;
  let f = FORMATS.get(key);
  if (f === undefined) {
    try {
      f = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
    } catch {
      f = null;
    }
    FORMATS.set(key, f);
  }
  return f;
}

/**
 * A stored amount as a currency string: formatMoney(4500, "usd") is "$45.00", formatMoney(5000, "jpy") is "¥5,000".
 * `digits` sets the decimal places shown (default the currency's own); `scale` is the stored unit (default the
 * currency's minor unit).
 * @param {number} amount
 * @param {string} currency an ISO 4217 code, either case
 * @param {{ scale?: number, digits?: number }} [options]
 */
export function formatMoney(amount, currency, options) {
  const code = currency.toUpperCase();
  const digits = options?.digits ?? currencyDigits(currency);
  const major = toMajorUnits(amount, currency, options);
  const f = formatter(code, digits);
  return f ? f.format(major) : `${major.toFixed(digits)} ${code}`;
}

/**
 * Whole units, no decimals, rounded ($10.60 reads as $11): for dense surfaces such as stat tiles and lists, where the
 * cents are noise.
 * @param {number} amount
 * @param {string} currency
 * @param {{ scale?: number }} [options]
 */
export function formatMoneyShort(amount, currency, options) {
  return formatMoney(amount, currency, { ...options, digits: 0 });
}

/**
 * A stored amount as the plain figure a number input or a CSV cell holds, with the currency's own places and no
 * grouping or symbol: "45.00", "5000", "12.345". Null gives "", an empty input.
 * @param {number | null | undefined} amount
 * @param {string} currency
 * @param {{ scale?: number, digits?: number }} [options]
 */
export function moneyInputValue(amount, currency, options) {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return "";
  return toMajorUnits(amount, currency, options).toFixed(
    options?.digits ?? currencyDigits(currency),
  );
}

/**
 * A figure someone typed ("45", "1,250.50", " 12.5 ") back into the stored integer, or null when it is blank,
 * negative or not a number. Grouping commas are allowed; a currency sign is not, so "$45" is null and the form says
 * what it wants.
 * @param {string | null | undefined} text
 * @param {string} currency
 * @param {{ scale?: number }} [options]
 * @returns {number | null}
 */
export function parseMoneyInput(text, currency, options) {
  const trimmed = (text ?? "").trim().replace(/,/g, "");
  if (!/^\d*\.?\d+$|^\d+\.$/.test(trimmed)) return null;
  return fromMajorUnits(Number(trimmed), currency, options);
}
