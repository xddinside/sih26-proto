/**
 * Continuous charge traffic driver (the reduced-profile stand-in for the
 * storefront checkout traffic). Sends a valid Visa/MasterCard charge every
 * 1/RPS seconds to the payment container and appends cumulative counters to a
 * JSONL log the capture reads for real client-side error-rate rows.
 *
 * Usage: bun run scripts/traffic.ts <port> <rps> <logfile>
 */
import { appendFile } from "node:fs/promises"

import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"

const PORT = Number(process.argv[2] ?? "50051")
const RPS = Number(process.argv[3] ?? "2")
const LOGFILE = process.argv[4] ?? "/tmp/opencode/driver-rows.jsonl"

const PROTO = process.env.OTEL_DEMO_ROOT
  ? `${process.env.OTEL_DEMO_ROOT}/pb/demo.proto`
  : "/tmp/opencode/demo-repo/pb/demo.proto"

const pkg = protoLoader.loadSync(PROTO, {
  keepCase: true,
  longs: Number,
  enums: Number,
  defaults: true,
  oneofs: true,
})
const oteldemo = grpc.loadPackageDefinition(pkg).oteldemo as unknown as {
  PaymentService: new (
    target: string,
    credentials: grpc.ChannelCredentials,
  ) => {
    charge: (request: unknown, callback: (error: unknown) => void) => void
    close: () => void
  }
}

const CARDS = ["4432801561520454", "5555555555554444"]

const client = new oteldemo.PaymentService(
  `127.0.0.1:${PORT}`,
  grpc.credentials.createInsecure(),
)

let sent = 0
let ok = 0
let err = 0

async function logRow(): Promise<void> {
  await appendFile(
    LOGFILE,
    `${JSON.stringify({ ts: new Date().toISOString(), sent, ok, err })}\n`,
  )
}

function charge(): void {
  const number = CARDS[sent % CARDS.length] ?? CARDS[0]
  const request = {
    amount: { currency_code: "USD", units: 123, nanos: 450000000 },
    credit_card: {
      credit_card_number: number,
      credit_card_cvv: 672,
      credit_card_expiration_year: 2039,
      credit_card_expiration_month: 1,
    },
  }
  client.charge(request, (error) => {
    if (error) err += 1
    else ok += 1
    sent += 1
  })
}

setInterval(charge, 1000 / RPS)
setInterval(() => {
  void logRow()
}, 5000)
void logRow()
console.log(`[traffic] started target=127.0.0.1:${PORT} rps=${RPS} log=${LOGFILE}`)
