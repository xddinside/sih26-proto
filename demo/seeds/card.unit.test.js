// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0
//
// T3 unit suite for the accepted card-type Hypothesis. Pure and mock-free:
// card.js depends only on simple-card-validator, so this runs with node --test
// and no OpenFeature, flagd, or OTel SDK.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateCard } = require('./card');

// Fixed "now" so the expiry clause is deterministic.
const CURRENT_YEAR = 2026;
const CURRENT_MONTH = 8;
const EXPIRATION_YEAR = 2039;
const EXPIRATION_MONTH = 1;

test('valid Visa accepted', () => {
  assert.equal(validateCard('4432801561520454', EXPIRATION_YEAR, EXPIRATION_MONTH, CURRENT_YEAR, CURRENT_MONTH), null);
});

test('valid Mastercard accepted', () => {
  assert.equal(validateCard('5555555555554444', EXPIRATION_YEAR, EXPIRATION_MONTH, CURRENT_YEAR, CURRENT_MONTH), null);
});

test('Amex rejected for card type', () => {
  assert.equal(
    validateCard('378282246310005', EXPIRATION_YEAR, EXPIRATION_MONTH, CURRENT_YEAR, CURRENT_MONTH),
    'Sorry, we cannot process amex credit cards. Only VISA or MasterCard is accepted.'
  );
});

test('expired card rejected', () => {
  assert.equal(
    validateCard('4432801561520454', 2025, 1, CURRENT_YEAR, CURRENT_MONTH),
    'The credit card (ending 0454) expired on 1/2025.'
  );
});
