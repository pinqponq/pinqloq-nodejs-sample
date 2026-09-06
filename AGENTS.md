# Project guidance

Read `.claude/rules/common.md` before changing sample code. Shared rules and skills are delivered from `.pinq-doq/`; do not edit the delivered copies or either submodule from this repository.

Use `import ... from "pinqloq"` for SDK integration. The archive in `packages/` is the temporary dependency source until the npm package is published. Do not import SDK implementation files from `vendor/`.

Keep credentials in the ignored `.env`. Generate synthetic data only. `npm test` must never send requests to the real ingest service; `npm run test:live` is the explicit live integration command.

Validate changes with `npm run typecheck`, `npm test`, and `npm run build`. Keep source code and identifiers in English. The sample interface and user-facing README are Turkish.
