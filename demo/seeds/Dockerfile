# Copyright The OpenTelemetry Authors
# SPDX-License-Identifier: Apache-2.0
#
# Demo Profile overlay of src/payment/Dockerfile. Adds card.js to the distroless
# production target and a Node `test-runtime` target (T3 card.unit.test.js and
# T5 payment.regression.test.js) on top of the pinned upstream builder image.


FROM docker.io/library/node:26.4.0-slim@sha256:a1d9d671994fc2d26e297ac56b4b1522a8bc7fa71c43b14cd1b1fe6c5116f7dc AS builder

WORKDIR /usr/src/app/

COPY ./src/payment/package.json package.json
COPY ./src/payment/package-lock.json package-lock.json

RUN npm ci --omit=dev

# -----------------------------------------------------------------------------
# test-runtime: node --test against the pure card.js seam (no flagd/OTel SDK).
# Usage:
#   docker build --target test-runtime -t payment-test-runtime .
#   docker run --rm payment-test-runtime node --test card.unit.test.js
#   docker run --rm payment-test-runtime node --test payment.regression.test.js
# -----------------------------------------------------------------------------

FROM builder AS test-runtime

COPY ./src/payment/card.js card.js
COPY ./src/payment/card.unit.test.js card.unit.test.js
COPY ./src/payment/payment.regression.test.js payment.regression.test.js

# -----------------------------------------------------------------------------

FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e

WORKDIR /usr/src/app/

COPY --from=builder /usr/src/app/node_modules/ node_modules/

COPY ./pb/demo.proto demo.proto

COPY ./src/payment/charge.js charge.js
COPY ./src/payment/card.js card.js
COPY ./src/payment/index.js index.js
COPY ./src/payment/logger.js logger.js

EXPOSE ${PAYMENT_PORT}

CMD ["index.js"]
