// SPDX-License-Identifier: Apache-2.0
/** Numerically safe extrema helper copied from SPIKE for the portable KiCad adapter. */
export function numericExtent(
  values: Iterable<number>,
  fallbackMinimum = 0,
  fallbackMaximum = fallbackMinimum,
): { minimum: number; maximum: number; count: number } {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let count = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
    count += 1;
  }
  return count ? { minimum, maximum, count } : { minimum: fallbackMinimum, maximum: fallbackMaximum, count: 0 };
}
