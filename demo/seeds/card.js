// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0
//
// Demo Profile overlay seam, extracted from src/payment/charge.js at the
// pinned Astronomy Shop commit 2e05c45b85b985a691cc75082c234e8d6ac0b2e9.
// Behavior-preserving: see smoke-behavior.test.js.

const cardValidator = require('simple-card-validator');

/**
 * Validate a credit card. Returns a rejection reason string, or null when the
 * card is accepted. Pure with respect to time: currentYear/currentMonth are
 * supplied by the caller.
 */
function validateCard(number, expirationYear, expirationMonth, currentYear, currentMonth) {
  const { card_type: cardType, valid } = cardValidator(number).getCardDetails();

  if (!valid) {
    return 'Credit card info is invalid.';
  }

  if (!['visa', 'mastercard'].includes(cardType)) {
    return `Sorry, we cannot process ${cardType} credit cards. Only VISA or MasterCard is accepted.`;
  }

  if (currentYear * 12 + currentMonth > expirationYear * 12 + expirationMonth) {
    const lastFourDigits = number.substr(-4);
    return `The credit card (ending ${lastFourDigits}) expired on ${expirationMonth}/${expirationYear}.`;
  }

  return null;
}

module.exports = { validateCard };
