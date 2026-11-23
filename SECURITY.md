# Security policy

## Reporting a vulnerability

Please report security vulnerabilities in SidekickDB privately, through
GitHub private vulnerability reporting: open the repository's Security tab and
choose "Report a vulnerability", or go straight to
https://github.com/SidekickDB/sidekick/security/advisories/new.

Do not report vulnerabilities in public issues, pull requests or discussions.
Use those only for problems that are not security sensitive.

## What to include

- The affected component (server, a client package, the CLI, the dashboard or
  the self-hosting stack) and the commit or version you tested.
- Steps to reproduce, with a minimal proof of concept if you have one.
- What an attacker can do with it, and under which configuration.
- Any fix or mitigation you suggest.

## What to expect

SidekickDB is maintained by one person. Reports are acknowledged and
investigated on a best-effort basis, and you can follow the discussion in the
private advisory. When a fix is ready, it lands on `main` and the advisory is
published, with credit to you unless you ask otherwise.

SidekickDB has not made a release yet, so there are no released versions to
list as supported. Fixes are made on `main` only.

## Scope

This policy covers the code in this repository. SidekickDB is an independent
continuation of InstantDB. This policy is not a channel for reporting issues in
Instant's own hosted service or in its repository.

Reports about code inherited from InstantDB are welcome here, including when
the bug also affects InstantDB; SidekickDB decides how and when InstantDB is
told.
