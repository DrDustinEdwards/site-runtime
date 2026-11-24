/**
 * The power of ten between a currency's minor unit and its whole unit: 0 for JPY, 3 for KWD, 2 for everything else,
 * including a code nobody recognizes (the commonest case).
 * @param {string} currency an ISO 4217 code, either case
 * @returns {0 | 2 | 3}
 */
export function currencyExponent(currency: string): 0 | 2 | 3;
/**
 * Decimal places a display of this currency carries: its exponent, except none for ISK and UGX.
 * @param {string} currency
 */
export function currencyDigits(currency: string): 0 | 2 | 3;
/**
 * A stored amount in whole units of its currency: 5000 JPY is 5000, 5000 USD is 50, 5000 KWD is 5. For charts and
 * exports that need the number.
 * @param {number} amount
 * @param {string} currency
 * @param {{ scale?: number }} [options]
 */
export function toMajorUnits(amount: number, currency: string, options?: {
    scale?: number;
}): number;
/**
 * The inverse, rounded to a whole stored unit: a chart value or a typed figure back into the stored integer.
 * @param {number} major
 * @param {string} currency
 * @param {{ scale?: number }} [options]
 */
export function fromMajorUnits(major: number, currency: string, options?: {
    scale?: number;
}): number;
/**
 * A stored amount as a currency string: formatMoney(4500, "usd") is "$45.00", formatMoney(5000, "jpy") is "¥5,000".
 * `digits` sets the decimal places shown (default the currency's own); `scale` is the stored unit (default the
 * currency's minor unit).
 * @param {number} amount
 * @param {string} currency an ISO 4217 code, either case
 * @param {{ scale?: number, digits?: number }} [options]
 */
export function formatMoney(amount: number, currency: string, options?: {
    scale?: number;
    digits?: number;
}): string;
/**
 * Whole units, no decimals, rounded ($10.60 reads as $11): for dense surfaces such as stat tiles and lists, where the
 * cents are noise.
 * @param {number} amount
 * @param {string} currency
 * @param {{ scale?: number }} [options]
 */
export function formatMoneyShort(amount: number, currency: string, options?: {
    scale?: number;
}): string;
/**
 * A stored amount as the plain figure a number input or a CSV cell holds, with the currency's own places and no
 * grouping or symbol: "45.00", "5000", "12.345". Null gives "", an empty input.
 * @param {number | null | undefined} amount
 * @param {string} currency
 * @param {{ scale?: number, digits?: number }} [options]
 */
export function moneyInputValue(amount: number | null | undefined, currency: string, options?: {
    scale?: number;
    digits?: number;
}): string;
/**
 * A figure someone typed ("45", "1,250.50", " 12.5 ") back into the stored integer, or null when it is blank,
 * negative or not a number. Commas are allowed only as thousands groups ("1,250.50", not "12,50"); a currency sign is not, so "$45" is null and the form says
 * what it wants.
 * @param {string | null | undefined} text
 * @param {string} currency
 * @param {{ scale?: number }} [options]
 * @returns {number | null}
 */
export function parseMoneyInput(text: string | null | undefined, currency: string, options?: {
    scale?: number;
}): number | null;
/**
 * The stored unit: the power of ten between the stored integer and the whole unit (3 for mills, 6 for micros, 0 for whole units). Default: the currency's minor unit.
 */
export type MoneyScale = {
    scale?: number | undefined;
};
/**
 * The decimal places shown. Default: the currency's own (2 for USD, 0 for JPY, ISK and UGX, 3 for KWD).
 */
export type MoneyDigits = {
    digits?: number | undefined;
};
