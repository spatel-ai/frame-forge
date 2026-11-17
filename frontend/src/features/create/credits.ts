const credits = new Intl.NumberFormat('en-IN')

/** Whole credits as the server sent them, grouped the Indian way. No arithmetic. */
export const formatCredits = (n: number) => credits.format(n)
