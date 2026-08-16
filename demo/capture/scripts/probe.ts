/**
 * Stage-1 probe ring driver: sends exactly N valid-card gRPC charge requests
 * to a payment container and reports the counts. The capture records the
 * resulting JSON as the probe receipt evidence.
 *
 * Usage: bun run scripts/probe.ts <port> <count> <card-number>
 */
import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"

const PORT = Number(process.argv[2] ?? "50051")
const COUNT = Number(process.argv[3] ?? "20")
const CARD = process.argv[4] ?? "4432801561520454"

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

const client = new oteldemo.PaymentService(
  `127.0.0.1:${PORT}`,
  grpc.credentials.createInsecure(),
)

const request = {
  amount: { currency_code: "USD", units: 123, nanos: 450000000 },
  credit_card: {
    credit_card_number: CARD,
    credit_card_cvv: 672,
    credit_card_expiration_year: 2039,
    credit_card_expiration_month: 1,
  },
}

const startedAt = new Date().toISOString()
let sent = 0
let ok = 0
let err = 0

await new Promise<void>((resolve) => {
  const finish = () => {
    if (sent < COUNT) return
    client.close()
    const outcome = {
      total: COUNT,
      ok,
      err,
      target: `127.0.0.1:${PORT}`,
      card: CARD,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
    console.log(JSON.stringify(outcome))
    resolve()
  }
  for (let i = 0; i < COUNT; i += 1) {
    client.charge(request, (error) => {
      if (error) err += 1
      else ok += 1
      sent += 1
      finish()
    })
  }
})
