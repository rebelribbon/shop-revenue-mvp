# shop-revenue-mvp

Design Partner MVP. The frozen build spec is [`docs/build-spec-v1.1.pdf`](docs/build-spec-v1.1.pdf) (v1.1, October 22, 2026).

Stack (spec D1/D2): one Next.js App Router app (TypeScript), one Graphile Worker process, one PostgreSQL database (Supabase, used as plain Postgres through Drizzle). The browser never queries the database.

Setup instructions are added with Milestone 1.
