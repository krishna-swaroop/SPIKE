# EMerge runtime compatibility and packaging

EMerge is an optional, separately installed engine in SPIKE. The trusted
`spike.emerge-suite` extension adapts EMerge 3 or newer; the desktop package
does not turn EMerge into a built-in solver and does not change the normal PI,
Thermal, or internal-solver release gates.

## Runtime selection and evidence

The setup's explicit **EMerge Python executable** is authoritative. When it is
blank, the adapter checks the project-local `.venv-emerge3`, the worker
interpreter, and then `.venv-emerge`. A runtime is admitted only when its probe
reports a 3+ version and the exact PCB, microwave, boundary, mesh-generation,
mesh-sizing, and topology-export APIs used by the adapter. Import success or a
version string alone is insufficient.

The compatibility panel distinguishes API detection from an executed adapter
fixture. `executed_fixture` is evidence for that recorded release and adapter
path; a later version with matching APIs remains qualification-pending until
its fixture evidence is recorded. Neither state establishes physical model,
convergence, radiation, or compliance validation.

## Portable and packaged installs

- Keep EMerge and optional EMCAD/Gerber extras in a dedicated environment.
  The runtime updater only operates on a selected dedicated environment and
  does not install into SPIKE's frozen worker.
- A packaged or sandboxed SPIKE must be able to execute and import from the
  selected interpreter. Host virtual environments are commonly invisible to
  Flatpak and other sandboxed builds; use a reachable interpreter or the
  platform's supported host bridge.
- Extension discovery, session trust, permissions, and runtime probing are
  independent gates. Installed extension metadata does not prove that an
  engine can run.
- The runner imports SPIKE's adapter modules from the shipped application root.
  Portable bundles must retain `extensions/emerge_suite` and the Python module
  tree with their relative layout. Launching only `runner.py` from a copied
  subdirectory is unsupported.
- Release-resource staging inventories tracked and current unignored source,
  or consumes `RELEASE_SOURCE_MANIFEST.json` in an exported tree. It resets its
  owned staging directory and writes a separate Tauri build configuration so a
  previous package cannot omit newly added adapter files or become the next
  package's input.
- Native Gerber support additionally requires EMerge's Gerber extra. Excellon
  drills are retained for provenance but block mesh/solve until the runner has
  an admitted drill implementation.

Generated scripts and results carry case/source digests. The extension result
and mesh admission layers also bind output to the current board. A board change,
stale script digest, malformed topology, or missing provenance rejects the
payload rather than publishing it into the active design.

The Python workspace service also accepts an explicit absolute
`python_executable`. It launches that interpreter with isolated Python flags and
bootstraps only SPIKE's shipped `python.spike_core`, `extensions`, and
`extension_sdk.python` package roots. Working directory, script filename,
workspace context, admitted UI actions, and result checks remain unchanged.
Packaged releases therefore include `extension_sdk/python` beside the extension
and worker sources; an arbitrary copied child module is not a supported runtime.

See [runtime updates](EMERGE_RUNTIME_UPDATES.md), [native Gerber](EMERGE_GERBER.md),
and [extension workspace engines](EXTENSION_WORKSPACE_ENGINES.md).
