# DocForce schemas

The authoritative contract is the TypeScript types in `src/model/types.ts`,
`src/config/types.ts`, and `src/pr/types.ts`.

This directory exists so consumers can attach JSON Schema later without
changing the package layout. v1.0 does not ship a generated JSON Schema;
runtime validation uses Zod only for AI-produced payloads.

See `docs/MODEL_SCHEMA_1.0.md` for System Model additive fields.
