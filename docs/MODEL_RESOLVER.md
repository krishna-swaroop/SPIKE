# Offline 3D model library and resolver

SPIKE indexes metadata for installed 3D model libraries in a local SQLite
cache. It does not copy, download, modify, transform, or redistribute model
assets. Source licensing remains the responsibility of the installed library.

## API

`spike_core.model_library` provides:

- `library_status(refresh=False, additional_roots=())`: discovers roots,
  refreshes a new or stale index, and reports roots, counts, truncation, and the
  cache location. `refresh=True` forces a full metadata refresh.
- `search_library(query='', limit=200, additional_roots=())`: searches indexed
  filenames and relative paths. The limit is bounded to 1,000.
- `resolve_model(reference='', footprint='', additional_roots=())`: returns a
  status, `automatic_path`, and candidates with path, relative path, name,
  format, root, reason, confidence, and exactness.
- `register_alias(reference='', footprint='', path='', confirmed=True)`: stores
  an explicitly user-confirmed mapping with the target SHA-256. Registration
  without `confirmed=True` is rejected.
- `add_library_root(path)`: validates and persists a source directory, then
  refreshes the index so it is immediately searchable.

Set `SPIKE_MODEL_INDEX_PATH` to choose the SQLite cache location. This is useful
for tests and portable workspaces. Otherwise the cache uses the platform user
cache directory. `SPIKE_MODEL_LIBRARY`, KiCad model environment variables, and
the existing SPIKE root discovery remain supported. A small set of known local
installation/sibling paths is inspected only when those directories exist.

## Conservative automatic resolution

Automatic selection is limited to:

1. a user-confirmed alias whose file still matches its recorded SHA-256;
2. an exact complete relative model path, including a KiCad model-variable
   prefix; or
3. an exact standard mapping from `Library:Name` to
   `Library.3dshapes/Name.step`, `.stp`, or `.wrl`.

An absolute reference to an existing supported model is returned with
`resolved_original` status. It is an exact caller-supplied source rather than
a library guess.

Alias lookup first uses the complete reference and footprint pair, then an
explicit footprint-only alias. This lets one approved footprint mapping repair
an unavailable source reference. If its target changes, resolution stops with
`alias_changed`; it does not fall through to another automatic match.

When the same exact relative identity exists in several roots, SPIKE hashes
only those shortlisted files. It selects the highest-priority root only if all
copies have identical content. Different content is reported as ambiguous.
For footprint identities, STEP is preferred, then STP, then WRL; alternate
representations remain visible as exact candidates. An explicit exact model
reference takes precedence over the footprint-derived identity.
If a standard KiCad VRML reference is unavailable, its STEP or STP counterpart
may resolve only at the same complete library-relative path. An existing
explicit VRML identity remains preferred. When visual staging copies a board,
existing project-relative model paths are rebased to the same absolute assets.
Basename and fuzzy matches are candidates for manual review and never populate
`automatic_path`. A changed or missing alias target is also refused.

## Refresh and limits

Queries use SQLite and do not rescan source subtrees. Root directory metadata
provides inexpensive stale detection; changes deeper in a library that do not
update the root directory can be picked up with `refresh=True`. Scans do not
follow directory or file symlinks, verify that each indexed path remains under
its root, and cap each root at 1,000,000 model files. A capped index reports
`truncated: true`.

The index contains paths, names, formats, sizes, timestamps, and explicitly
confirmed alias hashes. It contains no model bytes. Deleting the SQLite file is
safe; the next API call recreates it from installed libraries.

## Local validation snapshot

On 2026-10-02, a clean temporary index against the available local libraries
found 8,046 assets across three roots without truncation. The cold scan and
SQLite build took 5.18 seconds; a warm unfiltered 200-row query took 0.25
seconds. These measurements describe that machine and library set rather than
a performance guarantee.
