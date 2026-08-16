// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0
//
// Preservation test: proves the card.js seam (validateCard) is behavior-
// identical to the inline validation block of the upstream charge.js at the
// pinned commit 2e05c45b85b985a691cc75082c234e8d6ac0b2e9. Runs BEFORE any seed;
// depends only on simple-card-validator and node:test.
//
// Run: node --test smoke-behavior.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cardValidator = require('simple-card-validator');
const { validateCard } = require('./card');

/**
 * Reference: the validation block of upstream charge.js (lines 61-81 at the
 * pinned commit), lifted verbatim. Returns the thrown reason string or null.
 */
function upstreamValidate(number, year, month, currentYear, currentMonth) {
  const card = cardValidator(number);
  const { card_type: cardType, valid } = card.getCardDetails();

  if (!valid) {
    return 'Credit card info is invalid.';
  }

  if (!['visa', 'mastercard'].includes(cardType)) {
    return `Sorry, we cannot process ${cardType} credit cards. Only VISA or MasterCard is accepted.`;
  }

  if ((currentYear * 12 + currentMonth) > (year * 12 + month)) {
    const lastFourDigits = number.substr(-4);
    return `The credit card (ending ${lastFourDigits}) expired on ${month}/${year}.`;
  }

  return null;
}

const CURRENT_YEAR = 2026;
const CURRENT_MONTH = 8;

const fixtures = [
  // [number, expirationYear, expirationMonth]
  ['4432801561520454', 2039, 1], // valid Visa (upstream people.json card)
  ['4111111111111111', 2039, 1], // valid Visa
  ['4012888888881881', 2039, 1], // valid Visa
  ['5555555555554444', 2039, 1], // valid Mastercard
  ['4111111111111112', 2039, 1], // Luhn-invalid Visa
  ['5555555555554445', 2039, 1], // Luhn-invalid Mastercard
  ['378282246310005', 2039, 1], // Amex (valid Luhn, unsupported type)
  ['6011111111111117', 2039, 1], // Discover (valid Luhn, unsupported type)
  ['4432801561520454', 2025, 1], // expired Visa
  ['4432801561520454', 2026, 8], // expiry equal to now (not expired: strict >)
  ['4432801561520454', 2026, 7], // expired last month
  ['4432801561520454', 2039, 12], // valid future expiry
];

for (const [number, year, month] of fixtures) {
  test(`seam matches upstream for ${number} (${month}/${year})`, () => {
    const upstream = upstreamValidate(number, year, month, CURRENT_YEAR, CURRENT_MONTH);
    const overlay = validateCard(number, year, month, CURRENT_YEAR, CURRENT_MONTH);
    assert.equal(overlay, upstream, `expected ${JSON.stringify(upstream)}, got ${JSON.stringify(overlay)}`);
  });
}
