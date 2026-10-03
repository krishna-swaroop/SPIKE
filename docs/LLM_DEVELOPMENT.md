# LLM-driven development disclosure

SPIKE's development effort is largely driven by large language models (LLMs)
under human review. LLMs have been used to propose and produce substantial
portions of source code, tests, documentation, analysis, and other repository
changes.

This disclosure describes the development process and its limits. It does not
assign a percentage of the repository to LLMs, identify the origin of every
line, or replace the contribution and provenance records in version control.

## Human direction and responsibility

Humans set project goals, requirements, engineering constraints, and release
decisions. Humans who use, review, accept, or distribute a change remain
responsible for deciding whether its evidence is sufficient for the intended
purpose. An LLM cannot accept engineering, safety, licensing, or release
responsibility.

LLM output can include proposed designs, implementations, tests, documentation,
and interpretations of results. Such output can be incomplete, internally
consistent but incorrect, or based on mistaken assumptions. Its inclusion in
the repository under a human review process does not establish exhaustive
review of every part or independent qualification of any solver.

## Early community preview

SPIKE remains at an early stage of release. It may contain instabilities, bugs,
incomplete behavior, inaccurate outputs, or workflows that change between
releases. Capability labels and warnings should be read together with the
current [Solver Status](SOLVER_STATUS.md).

The community is invited to test SPIKE and provide feedback. Useful reports
include a small reproducible example, the SPIKE and dependency versions, input
files that may be shared, exact settings, observed and expected behavior, and
relevant logs. Usability reports and numerical comparisons with measurements or
other tools are welcome through the
[issue tracker](https://github.com/wayri/SPIKE-Main/issues). Match geometry,
materials, ports, boundary conditions, and solver settings when reporting a
numerical comparison.

## Evidence and validation

Checked-in tests, fixtures, reports, and validation records provide evidence for
the cases and acceptance criteria they actually exercise. They do not by
themselves provide independent physical validation, certify a design, establish
fitness for a particular application, or prove behavior outside the documented
model and validity limits.

Before relying on SPIKE for engineering decisions, a competent reviewer should
examine the relevant source, inputs, assumptions, units, model status, validity
limits, warnings, convergence evidence, and comparison data. Safety-critical,
high-consequence, or production decisions require review and validation suitable
for that application. Current capability and validation boundaries are recorded
in [Solver Status](SOLVER_STATUS.md) and the linked validation documents.

## Reproducibility and project records

The checked-in source, documentation, fixtures, tests, and version history are
the reproducible project record. Prompt history, private model state, and an
LLM's explanation are not sources of truth. Contributions remain subject to the
same review, provenance, testing, attribution, and validation requirements in
[Contributing](../CONTRIBUTING.md), regardless of how they were produced.

This disclosure does not change third-party credits, copyright notices, or
license boundaries. SPIKE-owned material is provided under the terms stated in
[Licensing](../LICENSING.md), and third-party material retains the terms and
attribution recorded in [Third-party notices](../THIRD_PARTY_NOTICES.md).

## Warranty and engineering reliance

SPIKE is experimental work in progress and is provided **AS IS** under its
existing license terms, without warranties or guarantees of accuracy,
reliability, or fitness for a particular purpose. The
[Apache License 2.0](../LICENSE) terms govern SPIKE-owned material. Users are
responsible for checking inputs, assumptions, results, and suitability before
relying on SPIKE.
