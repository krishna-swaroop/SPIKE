# SPIKE Security Model

## Runtime position

Node.js and npm are build-time tools only. A released desktop installer contains compiled Tauri assets and the local analysis worker/runtime. It does not execute npm, download JavaScript, contact a package registry, or load third-party web pages.

## Desktop shell

- Use Tauri IPC for privileged operations.
- Keep the webview on bundled assets.
- Maintain a restrictive Content Security Policy.
- Do not enable arbitrary filesystem, shell, or process permissions in the frontend.
- Put worker launch and file access behind narrowly scoped Rust commands.
- Validate all paths before passing them to the worker.
- Do not build shell command strings from board paths.
- Treat imported design files as untrusted input.
- Keep WebGL shader creation inside the bundled renderer; imported projects and
  models cannot supply scripts, remote URLs, or custom shader source.

## Local worker

- Prefer a private stdio JSON-line channel or OS-local authenticated channel.
- Never bind the worker to `0.0.0.0` by default.
- Validate request size, contract version, enum values, paths, and numeric ranges.
- Return structured errors without stack traces in the user-facing result.
- Apply cancellation and resource limits to mesh and frequency jobs.
- Keep temporary context and result files in an application-owned directory.
- Bound model-library searches and accept extra roots only after a native folder
  picker returns an explicit user selection.
- Validate model suffix, file size, triangle count, texture dimensions, and
  conversion time before caching an imported model.

## Supply chain

- Keep dependency lockfiles and use reproducible builds.
- Review dependency updates and their licenses before packaging them.
- Generate dependency notices and a software bill of materials for released packages.
- Build release artifacts in a clean environment, sign installers when available,
  and publish checksums alongside downloads.
- Keep signing keys and credentials out of source control, logs, and build artifacts.

## Updates and data

- Updates must be signed and rollback-capable.
- Local mode must not upload design data.
- Cloud execution must be explicit, encrypted, retention-controlled, and auditable.
- Logs redact credentials, tokens, and proprietary file contents.
- The integrated dependency manager is inventory-first and offline by default:
  it verifies bundled runtimes and signed manifests but does not mutate global
  Python/Node environments or execute package-manager scripts.
- Optional solver bundles are disabled when absent and are never fetched from
  an untrusted URL by the application.
- Telemetry is opt-in and limited to product health signals.

## Project package trust

- The Python package reader canonicalizes the signed manifest payload and
  validates archive structure, member sizes, SHA-256 digests, and the signature
  envelope contract. Its signature policy is optional; it does not own desktop
  trust decisions.
- Targeted Arrow geometry reads enforce the 256 MiB byte budget against both
  the manifest record and ZIP member before decompression or retention, and
  reject a declared/actual size mismatch. Canonical Arrow bytes are exact-match
  checked without `read_all` or `to_pylist`; the caller caps IPC at 256 MiB and
  rows at 10,000,000, with declared over-limit rows rejected in preflight before
  decode. Targeted source, model, STEP, and selector readers likewise compare
  actual ZIP and manifest sizes before retaining bytes.
- The Tauri host verifies signed `.spike` manifests with `ed25519-dalek` against
  public keys pinned into the desktop build. Signed packages fail closed before
  workspace state is applied when the key is unavailable, untrusted, malformed,
  or the payload/signature has changed. The host binds an approved canonical
  project path to the opened manifest identity; signed identity is derived only
  from the pinned-key-verified signed payload, and targeted model/selector reads
  require that exact binding.
- Build-time package keys are supplied through
  `SPIKE_PACKAGE_TRUSTED_KEYS_JSON`, or the single-key
  `SPIKE_PACKAGE_KEY_ID` and `SPIKE_PACKAGE_PUBLIC_KEY_B64URL` pair.
- Package-signing keys are separate from application runtime configuration and
  are never stored in the repository.
  Private signing keys must remain in an isolated release-signing service.
- Unsigned projects remain explicitly unsigned and must never be described as
  verified. A future organization policy may require signatures for all opens.
- Renderer manifest verification caps decoded input at 16 MiB. This is a
  resource bound, not an authentication claim for unsigned packages.

## Solver plugins

- Register only manifests using `spike/solver-plugin/v1`.
- Require process entry points to resolve inside their signed plugin directory.
- Launch fixed argument arrays with `shell=false` and a restricted environment.
- Give every job a private temporary directory, wall-clock timeout, result-size
  limit, and future OS-level CPU and memory limits.
- Treat plugin output as untrusted and validate its result contract before
  displaying or saving it.
- Do not pass host credentials, package-manager paths, or unrestricted project
  filesystem access to plugins.

## General extensions

- Discover only strict `spike/extension/v1` manifests.
- Keep unbundled extensions disabled until their exact ID is explicitly trusted.
- Run extension entrypoints as child processes without a shell.
- Resolve entrypoints inside the extension package and reject traversal.
- Pass only context fields allowed by declared permissions.
- Bound execution time and result size and validate
  `spike/extension-result/v1` before accepting output.
- Never inject third-party JavaScript into the Tauri webview; use structured
  results and schema-driven views.
- Treat process separation as an interim boundary. A public extension
  marketplace additionally requires signatures, publisher identity, revocation,
  and platform-native sandboxing.
- The ngspice adapter accepts explicit netlists only and rejects control blocks,
  include/load directives, shell commands, and user initialization files.
- Third-party SPICE models require a separate trust policy because model and
  code-model directives can execute or load content outside a pure circuit
  description.

## Security acceptance tests

- Launch without Node or npm installed.
- Launch without network access.
- Reject a path outside the selected project or approved temporary directory.
- Reject malformed worker requests.
- Verify the worker is not reachable on a public network interface.
- Verify the packaged app contains no development server URL.
- Verify a signed update rejects a tampered artifact.
- Verify signed `.spike` packages open only with a pinned package key and reject
  unknown keys, payload changes, and signature changes.
- Reject an unsigned or modified solver bundle.
- Reject a solver entry point that resolves outside its plugin directory.
- Terminate a solver that exceeds its time or output budget.
- Reject untrusted ngspice control, include, library, and load directives.
