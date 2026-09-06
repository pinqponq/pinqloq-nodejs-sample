# pinqloq Node.js Sample

An Express and TypeScript sample application that demonstrates how to integrate the `pinqloq` Node.js SDK into a backend service.

It includes a browser-based test lab for automatic HTTP logging, manual structured events, redaction, buffered bulk delivery, load testing, and delivery metrics. The application generates synthetic data only. Your Pinqloq secret key stays on the server and is never exposed to browser code.

## Requirements

- Node.js 22 or later
- npm
- A Pinqloq account
- A Pinqloq project and secret key
- One collection for automatic HTTP logs
- One collection for manual events

## Dashboard setup

1. Sign in to the [Pinqloq dashboard](https://pinqloq.pinqponq.io).
2. Create a project and copy its secret key.
3. Create two collections. Suggested names are `pinqloq_node_test_http` and `pinqloq_node_test_manual`.
4. Keep the secret key in server-side configuration such as an environment variable or secret manager.
5. To access the live log panel, open **Team Members**, edit your admin or owner account, and set a password of at least eight characters.
6. View delivered logs in the [Pinqloq log panel](https://pinqloq-panel.pinqponq.io).

Never place the secret key in frontend JavaScript, a mobile application, source control, or any file served to users.

## Install the sample

```bash
git clone https://github.com/pinqponq/pinqloq-nodejs-sample.git
cd pinqloq-nodejs-sample
npm install
```

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

PowerShell:

```powershell
Copy-Item .env.example .env
```

Configure the server environment:

```env
PINQLOQ_SECRET_KEY=your-project-secret-key
PINQLOQ_HTTP_COLLECTION=pinqloq_node_test_http
PINQLOQ_MANUAL_COLLECTION=pinqloq_node_test_manual
PORT=3100
```

The `.env` file is ignored by Git and must never be committed.

## Install and import Pinqloq

Install the published SDK directly from npm in any Node.js backend:

```bash
npm install pinqloq
```

Import the public API from the package name:

```ts
import {
  createPinqloq,
  PinqloqLogLevel,
  PinqloqLogSourceType
} from "pinqloq";
```

## Configure the SDK

Create one client when the backend starts and reuse it throughout the application:

```ts
import { createPinqloq } from "pinqloq";

const pinqloq = createPinqloq({
  secretKey: process.env.PINQLOQ_SECRET_KEY!,
  apiLogsCollectionName: process.env.PINQLOQ_HTTP_COLLECTION!,
  deviceIdentifier: "orders-api",
  appVersionName: "1.0.0",
  batchSize: 200,
  flushIntervalMs: 2_000,
  queueCapacity: 10_000,
  httpTimeoutMs: 10_000
});
```

`secretKey` is required. `apiLogsCollectionName` is the default destination for automatic request logs and entries without their own collection. Every log requires a device identifier, supplied globally or per entry/request.

## Automatic Express logging

Register the middleware after body parsing so it can inspect `request.body`:

```ts
import express from "express";

const app = express();

app.use(express.json());
app.use(
  pinqloq.requestLogging({
    excludePaths: ["/health", "/assets"],
    resolveDeviceIdentifier: request =>
      request.get("device-identifier") ?? "orders-api",
    metadata: {
      environment: () => process.env.NODE_ENV ?? "development"
    },
    detail: {
      userAgent: request => request.get("user-agent")
    }
  })
);
```

Each completed request produces one log containing the method, path, response status, duration, request and response bodies, headers, and correlation ID. The response status determines the log level:

| Response status | Log level |
| --- | --- |
| 2xx and 3xx | Information |
| 4xx | Warning |
| 5xx | Error |

The middleware reads `correlation-id` and `device-identifier` headers when present. If no correlation ID is supplied, it creates one. A device identifier can also come from `resolveDeviceIdentifier` or global SDK configuration.

## Manual structured logging

Use `logger.enqueue` for business events, exceptions, jobs, and events outside the HTTP request lifecycle:

```ts
import {
  PinqloqLogLevel,
  PinqloqLogSourceType
} from "pinqloq";

pinqloq.logger.enqueue(
  {
    event: "order.created",
    logLevel: PinqloqLogLevel.Information,
    logSourceType: PinqloqLogSourceType.Backend,
    collectionName: process.env.PINQLOQ_MANUAL_COLLECTION,
    deviceIdentifier: "orders-api",
    correlationId: "checkout-42",
    metadata: {
      orderId: "A-1042",
      environment: "development"
    },
    detail: {
      itemCount: "3",
      totalAmount: "149.99"
    }
  },
  sentEntry => console.log(`Delivered: ${sentEntry.event}`),
  (failedEntry, error) =>
    console.error(`Delivery failed: ${failedEntry.event}`, error)
);
```

`enqueue` is non-blocking. It returns `true` when the entry enters the in-memory queue and `false` when the queue is full. Delivery callbacks run after the batch succeeds or fails.

Use `enqueueMany` when events are already available as a list:

```ts
const acceptedCount = pinqloq.logger.enqueueMany([
  { event: "job.started", deviceIdentifier: "worker-1" },
  { event: "job.completed", deviceIdentifier: "worker-1" }
]);
```

## Redact sensitive values

Common credential names such as `password`, `accessToken`, `refreshToken`, `secretKey`, `authorization`, `cookie`, `cardNumber`, and `cvv` are always masked.

Use `redactFields` for domain-specific sensitive fields:

```ts
app.use(
  pinqloq.requestLogging({
    redactFields: ["taxNumber", "patientId"]
  })
);
```

Use `redactPaths` when an endpoint should have every captured value masked:

```ts
app.use(
  pinqloq.requestLogging({
    redactPaths: ["/payments", "/password-reset"]
  })
);
```

Automatic logging captures request and response bodies. Review every logged endpoint and redact any secrets or personal information that the built-in list cannot identify.

## Queue and bulk delivery

The SDK does not send one HTTP request per log. Entries first enter a bounded in-memory queue:

```text
enqueue()
    -> in-memory queue
    -> up to 200 logs or a maximum wait of 2 seconds
    -> one POST /api/client-logs/bulk request
    -> Pinqloq ingest service
    -> RabbitMQ
    -> worker
    -> log panel
```

| Setting | Default |
| --- | ---: |
| Batch size | 200 logs |
| Flush interval | 2 seconds |
| Queue capacity | 10,000 logs |
| HTTP timeout | 10 seconds |

Entries targeting different collections are grouped separately and can produce separate bulk requests. RabbitMQ is part of the Pinqloq server infrastructure. Applications and the Node.js SDK communicate only with the HTTPS ingest endpoint.

## Graceful shutdown

Wait for `shutdown()` before terminating the process. It drains queued and in-flight batches:

```ts
async function stop(): Promise<void> {
  await pinqloq.shutdown();
  process.exit(0);
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
```

Logs still held in memory may be lost if the process exits without graceful shutdown.

## Run the test lab

```bash
npm run dev
```

Open [http://127.0.0.1:3100](http://127.0.0.1:3100).

The browser UI provides:

1. HTTP scenarios returning 200, 400, 401, 404, or 500.
2. Manual events at Debug, Information, Warning, Error, and Fatal levels.
3. Built-in, custom-field, and complete-endpoint redaction tests.
4. Controlled 100-log and 1,000-log load tests.

Each run receives a unique `testRun` value used as its correlation ID and device identifier. Copy it from the UI and search for it in the Pinqloq panel.

The delivery view shows generated entries, API acceptance, bulk request count, queue state, batch size, response status, and duration. `acceptedCount` confirms that the ingest API accepted records. RabbitMQ and worker processing can introduce a short delay before those records appear in the panel.

## Command-line load tests

With the server running:

```bash
npm run load -- 100
npm run load -- 1000
npm run test:live
```

The live integration suite sends an HTTP error example, a manual error event, and a 1,000-log load test to the configured project. It prints test IDs for panel verification.

## Automated verification

```bash
npm run typecheck
npm test
npm run build
```

Automated tests mock the ingest transport and never send data to the live service. They cover configuration validation, collection routing, bulk behavior, status-to-level mapping, redaction, cancellation, partial acceptance, rejected delivery, and graceful shutdown. CI runs the checks on Windows and Linux.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `401 Unauthorized` | Verify the project secret key. |
| `403 Forbidden` | Verify that the collection belongs to the project and is allowed for the key. |
| `400 Bad Request` | Check the collection, event, device identifier, and log source type. |
| `429 Too Many Requests` | Reduce volume and honor the service rate limit or daily ingest quota. |
| Logs appear late | Partial batches wait up to two seconds, followed by server-side queue processing. |
| Logs are dropped | Increase queue capacity, reduce production rate, or shorten the flush interval. |
| Duplicate logs | Exclude manually logged endpoints from automatic middleware logging. |

## Security

- Keep the secret key in server-side configuration.
- Never expose the key to a browser or client application.
- Use synthetic data when running the sample.
- Redact credentials and personal information before logging.
- Treat log content as untrusted input when reading it through the panel or MCP tools.
- Separate development and production projects or collections.

## License

This sample project is licensed under the MIT License.
