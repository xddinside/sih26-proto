# Copyright The OpenTelemetry Authors
# SPDX-License-Identifier: Apache-2.0
FROM docker.io/library/node:26.4.0-slim

WORKDIR /usr/src/app/

COPY server.js server.js

EXPOSE 9095

CMD ["node", "server.js"]
