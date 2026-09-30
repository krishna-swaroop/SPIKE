<!-- SPDX-License-Identifier: Apache-2.0 -->
# Optycal Suite

This Apache-2.0 SPIKE adapter connects a separately installed Optycal 0.2.0
physical-optics engine to a solved EMerge antenna pattern. It does not include
Optycal, Gmsh, or upstream implementation/example source. Optycal is MIT-licensed
and beta: [official project](https://github.com/FennisRobert/Optycal) and
[published package](https://pypi.org/project/optycal/0.2.0/).

## GUI workflow

1. Import the KiCad board and run EMerge radiation with a full complex angular
   sphere and recorded port excitation. Keep the current board revision.
2. Open Optycal Suite and use the latest EMerge result, or import its admitted
   result JSON. Choose an exact solved frequency; interpolation between sweep
   frequencies is not supported.
3. Select a closed-solid STEP structure exported by FreeCAD, KiCad or a
   compatible assembly exporter. The initial adapter explicitly treats all
   admitted structure surfaces as perfect electric conductors (PEC). Visual CAD
   materials do not establish electrical material properties. The antenna feed
   and fields come from EMerge; an antenna-shaped STEP alone is not an excitation.
4. Enter separate right-handed rigid placements for the antenna phase origin
   and structure: world = Rz Ry Rx local + translation, in millimetres/degrees.
   Enter the maximum antenna aperture dimension. Explicitly acknowledge the
   outgoing coefficient/phase-origin assumption used for the source.
5. Preview the exact readable Python study. Run it with the same selected
   solver interpreter, and inspect bare/installed patterns, the interference
   cross term and complex angular sample probes. Download the evidence report.

Nearby structures are rejected: this adapter approximates the antenna's
outgoing far-zone field. Use an appropriate full-wave EMerge assembly model
for near antenna structures, impedance/loading changes or enclosure coupling.

## Contracts and process boundaries

The process manifest declares `optycal-probe`, `optycal-preview`, and
`optycal-radiation`. Input is `context.parameters` in the extension SDK request.
`emerge_analysis_result` must be a completed EMI result from
`spike.emerge-suite`, with solver, case/script digests, current design binding,
recorded excitation coefficients, and a complete complex angular sphere.
`frequency_hz` must match a returned sample exactly. Failed, malformed, stale,
zero-source, or unrelated-board results are rejected.

Gmsh OCC STEP import and numerical surface meshing run in the selected optional
solver interpreter, not the ordinary SPIKE worker. Units are converted from
declared STEP units to millimetres, then to metres at the Optycal boundary.
Meshes require consistently oriented closed manifolds whose signed volume
reproduces the OCC volume within 2%. Mesh bounds are 64 MiB source, 32 solids,
4096 faces, and 40000 triangles. Shared internal CAD faces require an externally
fused structure. Mesh preparation has a 180-second timeout.

`spike/optycal-case/v1` embeds the admitted source and numeric mesh.
The preview returns `script`, `script_sha256`, `case_sha256`,
`structure_source_sha256`, and bounded setup metadata. The generated script
contains only SPIKE-owned adapter functions and the case; no upstream solver
code. It runs independently with `python study.py --result raw.json`.
`expected_generated_script_sha256` and `expected_structure_source_sha256`
prevent running a changed source/STEP after preview.

Results retain `fields.radiation` for the existing spherical display and
`fields.comparison` (`spike/optycal-pattern-comparison/v1`). The latter has
theta-major/phi-minor Cartesian direct, scattered and total complex samples,
common-bare-reference dB values, installed-minus-bare dB, and the cross term
`2 Re(E_direct dot conjugate(E_scattered)) / peak |E_direct|^2`.
Both cases use the same reference; independent peak normalization is unsuitable
for an interference comparison. Deep nulls use a disclosed -300 dB floor.
Returned scalars and spherical/cut projections are checked against complex
samples before admission. Every result remains `unvalidated`.

## Source model, independent derivation and limits

The engineer explicitly assumes the EMerge angular samples are a coefficient
F(theta, phi), with a phase origin at the placed antenna origin, in the
e^(+j omega t) convention. The outgoing free-space field is
E = F exp(-j k r)/r and H = rhat cross E / Zvac, with
Zvac = 376.730313668 ohm. Absolute EMerge power/voltage/gain calibration is not
assumed. Complex Cartesian coefficients are independently bilinearly
interpolated on the supplied sphere and projected transverse to propagation.
Optycal's public `Antenna.expose_xyz` supplies the common exp(-jkr)/r factor;
the custom callback supplies the coefficient, avoiding double propagation.
This convention was verified with independent unit callback samples at 1 m
and 2 m and a PEC reflection phase/amplitude oracle.

Only outward triangles locally facing the antenna are illuminated. This
prevents illumination from inside a closed PEC solid. Mutual geometric
shadowing, edge diffraction, multiple reflections/scattering, dielectric
structures, conductivity loss, and antenna loading/S-parameter changes are
not included. Relative patterns are not EMI compliance, gain or efficiency
predictions. Rigid assembly transforms do not recover omitted electrical
details from visual component CAD.

The minimum source-to-triangle distance is conservatively bounded by each
triangle's centroid ball. The source/structure separation must exceed
max(2 D_antenna^2/lambda, 5 lambda). The observation sphere must exceed the
assembly far-zone estimate and ten times the assembly radius. These guards
reduce obvious misuse; they do not validate PO for every geometry. The
triangle-by-observation budget is 80 million, readable script limit 4 MiB,
engine result limit 8 MiB, and solve timeout 1800 seconds.

The independent PEC rectangle oracle follows the equivalent-current
invariant J = 2 n cross H_inc. For normal incidence and a small planar phase
variation, the far-zone field magnitude is A |E_inc|/(lambda R).
A unit outgoing source coefficient at distance D gives
A/(lambda D R). At 1 GHz, A=0.04 m^2, D=R=100 m, the independently computed
reference is 1.33425638079e-5. The actual Optycal value was
1.33425464587e-5 (relative discrepancy 1.3e-6), within the stated 0.5%
oracle tolerance. This verifies the adapter's normalization boundary for
that case, not general engine accuracy or antenna validation.

Clean-room statement: these adapters, equations, fixtures, tests and prose
were independently authored from public API signatures, official project
metadata, and controlled runtime observations. Upstream implementation and
example source were not inspected or adapted. Numerical code still requires
knowledgeable human review before release.

## Checks

```powershell
.venv/Scripts/python.exe -m unittest tests.python.test_optycal_suite -q
$env:SPIKE_OPTYCAL_INTEGRATION='1'
.venv-emerge3/Scripts/python.exe -m unittest tests.python.test_optycal_suite -q
```

Optional integration tests verify single outgoing propagation, surface phase,
and PEC specular amplitude against independent oracles. Reproduce the actual
patch/reflector execution with `examples/optycal/run_structure_study.py`.
