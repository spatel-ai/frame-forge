/** Rupees from paise the server sent, with Indian digit grouping. Paise show only when non-zero. No arithmetic on money. */
export function formatRupees(paise: number): string {
  const whole = paise % 100 === 0
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(paise / 100)
}
