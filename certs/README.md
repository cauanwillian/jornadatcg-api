# Supabase database CA

`supabase-ca-2021.crt` is the public Supabase Root 2021 CA downloaded by the
administrator from Database Settings in the Supabase dashboard on 2026-11-10.
It contains no credentials or private keys.

SHA-256 fingerprint:
`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.
The certificate expires on 2031-04-26. Review replacements through the official
dashboard and verify their origin before updating this trust anchor.

The Render API uses `PGSSLMODE=verify-full` and
`NODE_EXTRA_CA_CERTS=./certs/supabase-ca-2021.crt` to require TLS with certificate
and hostname verification. Do not use URL parameters that disable TLS or bypass
certificate verification. Prisma CLI migrations need the equivalent certificate
configuration for their own database engine.

Reference: https://supabase.com/docs/guides/platform/ssl-enforcement
