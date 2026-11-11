/** Money for display and for form inputs (money.mjs). */

/** The stored unit: the power of ten between the stored integer and the whole unit (3 for mills, 6 for micros, 0 for whole units). Default: the currency's minor unit. */
export interface MoneyScale {
  readonly scale?: number;
}

/** The decimal places shown. Default: the currency's own (2 for USD, 0 for JPY, ISK and UGX, 3 for KWD). */
export interface MoneyDigits {
  readonly digits?: number;
}

/** The power of ten between a currency's Stripe minor unit and its whole unit: 0 for JPY, 3 for KWD, 2 otherwise. */
export function currencyExponent(currency: string): 0 | 2 | 3;

/** Decimal places a display of this currency carries: its exponent, except none for ISK and UGX. */
export function currencyDigits(currency: string): number;

/** A stored amount in whole units: 5000 JPY is 5000, 5000 USD is 50, 5000 KWD is 5. */
export function toMajorUnits(amount: number, currency: string, options?: MoneyScale): number;

/** Whole units back to the stored integer, rounded. */
export function fromMajorUnits(major: number, currency: string, options?: MoneyScale): number;

/** A stored amount as a currency string in en-US: "$45.00", "¥5,000". A code Intl refuses prints as "50.00 XYZ". */
export function formatMoney(
  amount: number,
  currency: string,
  options?: MoneyScale & MoneyDigits,
): string;

/** Whole units, no decimals, rounded: "$11" for 1060 cents. */
export function formatMoneyShort(amount: number, currency: string, options?: MoneyScale): string;

/** The plain figure for a number input or a CSV cell: "45.00", "5000"; "" for null. */
export function moneyInputValue(
  amount: number | null | undefined,
  currency: string,
  options?: MoneyScale & MoneyDigits,
): string;

/** A typed figure ("1,250.50") back to the stored integer, or null when blank, negative, signed or not a number. */
export function parseMoneyInput(
  text: string | null | undefined,
  currency: string,
  options?: MoneyScale,
): number | null;
