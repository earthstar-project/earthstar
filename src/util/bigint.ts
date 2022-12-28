export function bigIntToHex(number: bigint) {
  const base = 16;
  let hex = number.toString(base);
  if (hex.length % 2) {
    hex = "0" + hex;
  }
  return hex;
}

export function bigIntFromHex(hex: string) {
  return BigInt("0x" + hex);
}
