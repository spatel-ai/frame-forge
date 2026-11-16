export const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n)

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong'
}
