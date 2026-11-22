/**
 * Reduces a VTEX catalog response to the fields the adapter uses plus a few
 * identifying ones, so recorded fixtures stay small (DRT 6.5). Development
 * tool only: runs on fixtures, never on production data.
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
const obj = (value) => (typeof value === 'object' && value !== null ? /** @type {Record<string, unknown>} */ (value) : {});

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
const arr = (value) => (Array.isArray(value) ? value : []);

/**
 * @param {string} body raw catalog JSON
 * @returns {string} trimmed, pretty-printed JSON with a trailing newline
 */
export function trimCatalog(body) {
  const products = arr(JSON.parse(body)).map((product) => {
    const p = obj(product);
    return {
      productId: p.productId,
      productName: p.productName,
      linkText: p.linkText,
      items: arr(p.items).map((item) => {
        const i = obj(item);
        return {
          itemId: i.itemId,
          name: i.name,
          sellers: arr(i.sellers).map((seller) => {
            const s = obj(seller);
            const offer = obj(s.commertialOffer);
            return {
              sellerId: s.sellerId,
              sellerName: s.sellerName,
              sellerDefault: s.sellerDefault,
              commertialOffer: {
                Price: offer.Price,
                ListPrice: offer.ListPrice,
                AvailableQuantity: offer.AvailableQuantity,
                IsAvailable: offer.IsAvailable,
                Installments: arr(offer.Installments).map((line) => {
                  const l = obj(line);
                  return {
                    PaymentSystemName: l.PaymentSystemName,
                    NumberOfInstallments: l.NumberOfInstallments,
                    Value: l.Value,
                    TotalValuePlusInterestRate: l.TotalValuePlusInterestRate,
                    InterestRate: l.InterestRate,
                  };
                }),
              },
            };
          }),
        };
      }),
    };
  });
  return `${JSON.stringify(products, null, 2)}\n`;
}
