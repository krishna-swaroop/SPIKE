<!-- SPDX-License-Identifier: Apache-2.0 -->
# Coupled assembly studies

Open **MCAD assembly -> Board instances and harnesses -> Coupled multi-board
analysis** with two or more retained boards, or a board plus a physical
mechanical part. Save graph edits before running.
The desktop worker executes the following bounded models:

| Domain | Shared solve | Connection properties |
| --- | --- | --- |
| PI | One DC/AC MNA circuit, including every board occurrence | Harness/mate pin R/L, separate endpoint contact R/L, optional explicit-reference pi C |
| SI | One linear AC MNA circuit including passive part circuits | Connector/harness properties and explicit chassis bond R/L; sources, loads and returns are explicit |
| Thermal | One steady/transient board and mechanical-body RC/radiosity network | Retained contacts with reviewed W/K conductance, reciprocal surfaces, emissivity and view factors |
| EM | Reciprocal board/structure magnetic RL loop impedance matrix | Signed mutual inductance between loops, explicit board-loop connector contact R/L |

These are actual interacting solves: a remote load changes PI voltage, a
contact changes SI transfer, heat crosses a thermal contact, and a driven
loop induces current in an undriven board loop. They remain reduced models.
They do not extract complete PCB fields from imported artwork or calculate
assembly radiation, shielding, EMI compliance, airflow or thermal spreading.
The graph-only planner continues to block general coupled field qualification.

## Workflow

1. Import boards, create reviewed direct mates or virtual harnesses, save links.
2. Choose the domain. The worker derives occurrence and pin inventories, leaving
   unknown physical properties blank. Zero is an explicit ideal model choice.
3. For PI/SI, add each board's linear circuit elements. Connector terminal names
   are board-local `connector:pin`. Supply the source, load and return circuit;
   a local node named `0` on another board is not automatically grounded.
4. Enter conductor and endpoint contact properties for every retained pin pair.
   Optional pi capacitance with its explicit reference goes in model JSON.
   For thermal, define contacts in the assembly semantics editor, then set
   power, ambient paths and contact conductances. Study conductance is a reviewed
   override of retained contact metadata. Transient RC nodes go in model JSON.
5. For EM, define closed-loop R/L, RMS voltage phasors, frequencies and signed
   mutual inductances measured or extracted for the current placement. Assign
   connector contacts to their actual loop and retained physical pin.
   Structure loops can be driven or passive with an explicit zero drive.
6. Run the coupled study. Inspect occurrence results, diagnostics, conservation
   and limitations. DC circuit links report conductor and each contact's I²R
   loss. Apply those losses to named thermal nodes only after reviewing the
   physical heat partition; no automatic electrical/thermal mapping is made.
7. Save the setup, save with results, or export a standalone setup/results JSON.
   **Open setup / results file** loads that file directly in the same domain.

### Casings and other mechanical structures

Import or author physical parts in the retained assembly, then open **Coupled
studies**. Each physical part must have an explicit model; imported solids and
material names do not infer numerical properties. Model-less subassembly
containers are reported as hierarchy exclusions.

- Thermal: enter structure dissipation, ambient path and transient heat capacity.
  Map retained thermal contacts to board/part local nodes. Enclosed bodies may
  omit direct ambient resistance and reject heat through contacts or explicit
  reciprocal radiation surfaces in advanced model JSON.
- PI/SI: add passive R/L/C elements to the structure model. Map every retained
  electrical bond to board/part local nodes and enter contact R/L. Select the
  ground owner explicitly; equal local net names and a casing called ground do
  not create electrical connections.
- EM: enter structure loop R/L, RMS drive and mutual inductance to board loops.
  This represents an authored magnetic reduction, not general shielding or
  full-wave geometry. Bond and rigid-flex topology is rejected by this path.

Results include part temperatures, part circuit voltages and part loop currents.
Setups, properties and outputs survive offline project save/reopen; changes to
part placement or models invalidate result binding. Missing models, floating
thermal rejection paths and floating circuit returns remain actionable errors
or blocked solves. The solver-suite field integration work is tracked separately
in [assembly structure validation](validation/ASSEMBLY_STRUCTURE_STUDIES_20261004.md).

## Contracts and persistence

Worker methods: `prepare_multiboard_study`, `run_multiboard_circuit`,
`run_multiboard_thermal`, `run_multiboard_em`,
`validate_multiboard_study_result`. Manifest-bound package mutation:
`save_multiboard_study_in_project`. Requests and results use independent v1
contracts described in [circuit](MULTIBOARD_CIRCUIT.md),
[thermal](MULTIBOARD_THERMAL.md) and [EM](MULTIBOARD_EM.md).

SPIKE v3 stores per-domain setup under AssemblyIR extensions
`spike.multiboard-studies`, with results in verified state artifacts. The
physical assembly digest excludes this extension; result request digests bind
the exact setup and canonical physical assembly. Editing topology, placement
or properties invalidates active results. Save without results keeps setups
and drops coupled outputs/artifacts too. Standalone files use
`spike/multiboard-study-file/v1` with `domain`, `assembly_digest`, `request`
(no embedded assembly) and nullable `result`. Import checks bind the setup and
result to the current physical assembly; hashes are consistency checks, not
authentication or physical qualification of externally supplied results.

Draft saving permits unfinished numeric fields and empty circuit tables.
Execution uses strict numeric/identity/coverage admission. Imported malformed
tables fail before rendering; stale asynchronous results are discarded.
Missing properties, floating returns, unsupported physics, singular systems,
resource limits and mismatched results produce diagnostics. No-result copies
do not modify the live project. Export transport is bounded to 8 MiB per study.

## Verification and release limits

`test_multiboard_circuit.py`, `test_multiboard_thermal.py`,
`test_multiboard_em.py` use independent analytical fixtures and parameter
sensitivity. `test_multiboard_study.py` exercises actual solves, bound save,
artifact hydration, reopen and result-free copies. Frontend presentation
checks cover malformed drafts and per-occurrence result projection.
Numerical status remains approximate/experimental, production_qualified=false.
Knowledgeable human numerical review and hardware/external validation remain
required before release qualification. No new dependencies are introduced.
