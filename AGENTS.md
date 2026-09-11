# Project guidance

Read `.claude/rules/common.md` before changing sample code. Shared rules and skills are delivered from `.pinq-doq/`; do not edit the delivered copies or that submodule from this repository.

Use `import ... from "pinqloq"` for SDK integration. `pinqloq` is a normal npm dependency published at [npmjs.com/package/pinqloq](https://www.npmjs.com/package/pinqloq) — never import its implementation files directly, and never vendor or pin it to a git commit again.

The secret key and collection names are entered at runtime through the **Connect** card (`POST /api/session`), held in server process memory only — never in an `.env` file, never echoed back in a response. Generate synthetic data only. `npm test` must never send requests to the real ingest service; `npm run test:live` is the explicit live integration command.

Validate changes with `npm run typecheck`, `npm test`, and `npm run build`. Keep source code and identifiers in English. The sample interface and user-facing README are Turkish.
