/**
 * The seeded payment source states the real implementer worktree starts from
 * (issue #23). The live capture reads the demo repo; the offline capture
 * replays these recorded copies of the seeded `src/payment/card.js`.
 *
 * The seeded card-type clause is inverted: valid Visa cards are rejected and
 * everything else is accepted. The implementer's one-line restoration is the
 * captured diff.
 */
const CARD_JS_HEADER = `// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

"use strict";

const cardTypeCheck = (cardNumber) => {
  if (cardNumber.startsWith("4")) {
    return "VISA";
  }
  return "OTHER";
};

const validVisa = (cardNumber) => cardNumber.startsWith("4") && cardNumber.length === 16;
`;

/** The S1 seeded card.js (the demo shop's fixed candidate card is a Visa). */
const CARD_JS_SEEDED_S1 = `${CARD_JS_HEADER}
const validateCard = (cardNumber, cardType) => {
  // Seeded defect: the card-type clause is inverted, so every valid charge
  // is refused while invalid charges pass.
  if (cardTypeCheck(cardNumber) === cardType && cardType === "VISA") {
    throw new Error("Sorry, we cannot process visa credit cards. Only VISA or MasterCard is accepted.");
  }
  if (!validVisa(cardNumber) && cardType === "VISA") {
    throw new Error("invalid card number");
  }
  return { ok: true, cardType };
};

module.exports = { validateCard };
`;

/** The S2 seeded card.js (same inverted clause, alternate Luhn check). */
const CARD_JS_SEEDED_S2 = `${CARD_JS_HEADER}
const luhn = (cardNumber) => {
  let sum = 0;
  let double = false;
  for (let i = cardNumber.length - 1; i >= 0; i -= 1) {
    let digit = Number(cardNumber[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
};

const validateCard = (cardNumber, cardType) => {
  // Seeded defect: the card-type clause is inverted, so every valid charge
  // is refused while invalid charges pass.
  if (cardTypeCheck(cardNumber) === cardType && cardType === "VISA") {
    throw new Error("Sorry, we cannot process visa credit cards. Only VISA or MasterCard is accepted.");
  }
  if (!luhn(cardNumber) && cardType === "VISA") {
    throw new Error("invalid card number");
  }
  return { ok: true, cardType };
};

module.exports = { validateCard };
`;

/** The seeded card.js content for one run's implementer worktree. */
export function seededCardJs(seed: "S1" | "S2"): string {
  return seed === "S1" ? CARD_JS_SEEDED_S1 : CARD_JS_SEEDED_S2
}
