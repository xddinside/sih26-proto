// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0
//
// T5 scoped regression suite for the Payment ownership map. It checks the wider
// payment validation surface beyond the card-type clause: Luhn-invalid cards
// must be rejected. Each case asserts only that the card is rejected, not which
// guard rejects it, so it passes on either seeded image (S1/S2 invert the
// card-type clause, which still rejects these Visa/Mastercard numbers) and
// fails deterministically once the card-type clause is restored while the Luhn
// guard is missing (Run 2's masked defect).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateCard } = require('./card');

const CURRENT_YEAR = 2026;
const CURRENT_MONTH = 8;
const EXPIRATION_YEAR = 2039;
const EXPIRATION_MONTH = 1;

test('Luhn-failing Visa is rejected', () => {
  assert.notEqual(
    validateCard('4111111111111112', EXPIRATION_YEAR, EXPIRATION_MONTH, CURRENT_YEAR, CURRENT_MONTH),
    null
  );
});

test('Luhn-failing Mastercard is rejected', () => {
  assert.notEqual(
    validateCard('5555555555554445', EXPIRATION_YEAR, EXPIRATION_MONTH, CURRENT_YEAR, CURRENT_MONTH),
    null
  );
});
