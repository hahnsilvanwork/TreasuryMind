// XRPL currency-code encoding. Standard codes are ≤3 chars (e.g. "USD"); anything longer
// (e.g. "RLUSD") MUST be a 160-bit / 40-char uppercase hex string, right-padded with zeros.
export function toCurrencyHex(code: string): string {
  if (code.length <= 3) return code;
  return Buffer.from(code, 'ascii').toString('hex').toUpperCase().padEnd(40, '0');
}
