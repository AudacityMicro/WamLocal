/** Unambiguous legacy alloy spelling; never merge different grades. */
export const canonicalStockName = (name: string) => name.replace(/^Aluminum\s+(6061|7075)$/i, "Aluminum - $1");
