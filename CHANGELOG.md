# Changelog

All notable changes to Potomac HQ are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

Every pull request into `staging` adds a line under Unreleased. A release
moves those lines under a version heading. See `docs/conventions.md`.

## [Unreleased]

### Added

- M0 discovery documents: workflow, tool boundaries, stack decision 0001,
  first-slice data model and authorization matrix.
- Repository scaffold: `src/<module>/<layer>` structure for the `shared`,
  `identity` and `crm` modules, with one public entry file per module.
- Boundary lint (dependency-cruiser) that fails when `domain` or `application`
  imports Zubra, a UI framework or another module's internals, with a
  self-test that proves each rule fires.
- Test runners: `node:test` for domain, unit and integration tests, Playwright
  for end-to-end tests.
- CI on GitHub Actions, including a job that runs domain tests with no
  packages installed.
- Release automation: a changelog gate on pull requests and an automatic
  GitHub release when `staging` is merged into `main`.
