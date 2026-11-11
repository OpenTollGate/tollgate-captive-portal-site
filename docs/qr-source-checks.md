# Manual QR source checks

`qr-source-check.yml` isolates read-only source verification from CI's PR
comment writer and the demo deployment workflow. It runs the full Vitest
suite and build, plus the admin guest-Wi-Fi QR/print browser suite against
the mock server. The browser job is independent so a unit-suite failure
cannot hide its result. Ubuntu 24.04 keeps the locked Playwright version on
a supported hosted image.

Once this workflow exists on the repository's default branch, select the
feature branch with `gh workflow run qr-source-check.yml --ref <branch>`.
A branch-only workflow may not yet be registered for dispatch; that is an
owner integration prerequisite, not permission to change main or deploy.
Record the run's exact head SHA. A fork result does not populate upstream
protection and is not deployed-router acceptance. This lane neither uses
secrets nor publishes artifacts or comments; existing CI/deploy triggers
and permissions are unchanged.
