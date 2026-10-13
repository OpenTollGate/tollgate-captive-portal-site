# AGENTS.md — OpenTollGate/tollgate-captive-portal-site

Instructions for AI coding agents. The cross-repository policy (ownership
map, verification hierarchy, agent principles) is
https://github.com/OpenTollGate/physical-router-test-automation/blob/main/docs/engineering-policy.md

## Cross-Repository Engineering Ownership and Verification

**This repository owns the captive-portal application**: portal code,
assets and UI behavior, and portal-specific implementation tests and
contracts.

Neighbors — do not duplicate them:

- Consumers (e.g. `OpenTollGate/tollgate-module-basic-go`) depend on a
  **pinned, identifiable revision** of this repo (their
  `packaging/build-inputs.json`) and stage the five build products from
  that pin (guest SPA, admin SPA, rpcd plugin, rpcd ACL, admin
  uci-default). Never maintain divergent in-tree copies of portal code.
- Deployed-portal acceptance (portal served by a real OpenWrt install) is
  owned by `OpenTollGate/physical-router-test-automation` and the module
  repo's happy-path/router-happy-path lanes — portal UI changes that
  matter on-router are verified there, against the pinned build.

Agent rules: keep build placeholders (e.g. `__ADMIN_HOME__`) substitutable
and never hard-code a consumer's value; a release pin points at a revision
whose tree owns the whole bundle — partial bundles are a hard error at the
consumer, fix them here; UI copy is a behavior contract (PRTA's
portal-tab-copy tests pin it) — change the contract deliberately, not as a
drive-by.
