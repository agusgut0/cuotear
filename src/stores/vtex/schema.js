import Ajv2020 from 'ajv/dist/2020.js';

/**
 * JSON Schema of the subset of the VTEX catalog response the adapter reads
 * (DRT 6.1: validated with an Ajv schema of the fields used). Extra fields
 * are ignored. Installment lines are validated one by one in the adapter so a
 * single odd line does not discard the whole product.
 */
export const catalogSchema = {
  type: 'array',
  items: {
    type: 'object',
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['itemId', 'sellers'],
          properties: {
            itemId: { type: 'string', maxLength: 64 },
            sellers: {
              type: 'array',
              items: {
                type: 'object',
                required: ['sellerId', 'commertialOffer'],
                properties: {
                  sellerId: { type: 'string', maxLength: 64 },
                  sellerDefault: { type: 'boolean' },
                  commertialOffer: {
                    type: 'object',
                    required: ['Price', 'AvailableQuantity'],
                    properties: {
                      Price: { type: 'number', minimum: 0, exclusiveMaximum: 1e10 },
                      AvailableQuantity: { type: 'number' },
                      IsAvailable: { type: 'boolean' },
                      Installments: { type: 'array' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

/** @type {import('ajv').ValidateFunction | undefined} */
let compiled;

/** @returns {import('ajv').ValidateFunction} */
export function catalogValidator() {
  compiled ??= new Ajv2020.default({ allErrors: false, strict: true }).compile(catalogSchema);
  return compiled;
}
