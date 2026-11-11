# ADR 0001: Licence

- Status: Accepted
- Date: 2026-10-25

## Context

The core must be usable by DIY and Home Assistant users with their own keys,
while the maintainer keeps the option to license the code under other terms.
The CLA is in [`docs/licensing/CLA.md`](../licensing/CLA.md).

## Decision

Release the core under AGPL-3.0-only with a Contributor Licence Agreement
(a licence grant, not a copyright assignment). Fallback: Apache-2.0 with DCO.

## Consequences

- Modified network or app deployments by others must publish their changes.
- The maintainer can license core and contributed code under other terms
  because of the CLA. Contributors need to sign it.
- Core dependencies must be permissive, so the code stays relicensable.
  Enforced in CI.
- Data source licences are tracked separately in `THIRD_PARTY.md`.
- Name and logo are not covered by this licence.
