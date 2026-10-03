<!-- SPDX-License-Identifier: Apache-2.0 -->
# Arduino shield and Raspberry Pi source acceptance (2026-10-02)

## Reproduction

Run from the repository root with KiCad 10 and the project environment:

```powershell
.\.venv\Scripts\python.exe scripts\build_arduino_shield_acceptance.py
.\.venv\Scripts\python.exe scripts\build_arduino_shield_acceptance.py --offline
```

The first command downloads two digest-pinned official Arduino CAD archives to
`build/arduino-shield-acceptance-20261002/sources`; the second proves the run is
repeatable without network access. Neither third-party board is checked into
the Apache-2.0 repository. The generated project and evidence stay under
`build/arduino-shield-acceptance-20261002`.

## Actual source boards and provenance

| Board | Primary source | Archive SHA-256 | License in archive | KiCad 10 import |
| --- | --- | --- | --- | --- |
| Arduino UNO R4 Minima ABX00080 | [Arduino CAD download](https://docs.arduino.cc/static/ae97aad5c05de6a565c7f93a28c04717/ABX00080-cad-files.zip), Altium `PCB.PcbDoc` | `37d7bcab7a6048619abdecee6d41582b825c3a1d045bb26821c1e36dcbd9ce26` | CC BY-SA 4.0, `License.txt` | completed; 85 components, 304 pads, 64 nets |
| Arduino 4 Relays Shield A000110 | [Arduino CAD download](https://docs.arduino.cc/static/c919f2fcead5d5e20cd8957999d0297f/A000110-cad-files.zip), Eagle `4RelaysShieldV2.0.brd` | `825d46d3f223a8be0a575cc6cf30979ef58b16b2f571032a2942d4ce0aab90a8` | CC BY-SA 4.0, `License.txt` | completed; 47 components, 167 pads, 35 nets |

The package contains two distinct retained designs and their real outlines,
copper, pads, nets, and components. The shield frame is translated by
`(114.2111, 131.6736, 11)` mm, derived from the actual connector pad centers.
This places it 11 mm above the UNO and aligns `JANALOG`/`POWER0` pins 5 and 6
within `2.9e-14` mm in XY. `placement-evidence.json` records both source and
world coordinates; source artwork coordinates remain unchanged.
The accepted connector graph explicitly mates UNO `JANALOG` pins 5/6 to shield
`POWER0` pins 5/6 and UNO `JDIGITAL` pin 6 to shield `JLOW0` pin 6. `GND` has
the same spelling in both imported designs but separate design-local net IDs
until that mate is authored. The package does not merge unrelated equal names.

The Altium conversion reports unmapped internal-plane-number layers and one
measurements layer. The converted UNO and Eagle shield each expose two copper
layers, and neither converted board retains a material stackup declaration.
These import limitations are recorded in `source-provenance.json` and
`summary.json`; converted artwork does not establish field-model readiness.
Native KiCad 10 DRC is also intentionally reported rather than treated as a
clean-board gate: the converted UNO produces 904 findings (largely imported
tracks on layers whose Altium semantics were not mapped) and zero unconnected
items. The converted Eagle shield cannot enter DRC because some imported items
remain on KiCad's `UNDEFINED` layer. Conversion parse success therefore does
not establish design-rule parity with either source tool.

An official Motor Shield Rev3 A000079 archive was also checked. Its
`Shield_Motor-REV3c.brd` is legacy binary Eagle, and KiCad 10 rejects it as
non-XML. It was not relabelled or replaced with fabricated geometry.

## Executed coupled paths

The saved `arduino-r4-relay-shield.spike` project verified its manifest digest
`c588862b359d8fb8c7b040f53d10934a570202edca1639a43282812a74d01cb5` in
the recorded run. All inputs below are explicit reduced assumptions; none were
extracted as connector, cable, thermal, or magnetic parameters from artwork.

| Path | Observed run | Interpretation |
| --- | --- | --- |
| PI | completed; 5 V source, 25 ohm shield load, 0.998402 W load power, about 0.399 mW in each assumed 10 milliohm power/return contact | Experimental DC reduced MNA, not a board voltage-drop field solve. |
| SI | completed 17-point 1 kHz to 10 MHz AC sweep through D5 and return, with assumed 20 milliohm/5 nH signal contact and 10 kohm receiver | Experimental linear AC network, not a transmission-line extraction, eye, or S-parameter qualification. |
| Thermal and radiation | completed; UNO 33.5078 C, shield 39.3628 C at 25 C ambient; energy residual `-8.10e-14 W`; shield-to-UNO radiative transfer magnitude 0.06226 W | Approximate two-node RC/radiosity solve. Board areas come from retained outlines; 18/22 K/W, emissivity 0.85, view factor 0.55, and 0.025 W/K contact are supplied assumptions. |
| EM screening | completed four frequencies; reciprocal assumed 0.15 uH coupling, maximum induced shield-loop current 0.05483 A; normalized energy eigenvalue 0.8631 | Experimental lumped magnetic-loop solve. `field_coupling_executed=false`. Loop R/L/M are supplied assumptions and do not describe the imported board geometry without extraction or measurement. |

`unsupported-em-capabilities.json` explicitly records full-wave coupled EM and
far-field radiation as unsupported. The thermal radiation result is heat
exchange, not electromagnetic radiation.

## Raspberry Pi and HAT availability investigation

Raspberry Pi publishes the real CM4 IO Board complete KiCad project through
its [Product Information Portal](https://pip.raspberrypi.com/categories/1210-design-files).
The 2025-10-06 `CM4IO-KiCAD` archive downloaded with SHA-256
`5ea867e17968cb9c117fbce7a982ea395d66a6ee605253a9a0879483bbfcb0aa`.
SPIKE imported `CM4IOv5.kicad_pcb` as 151 components, 944 pads, 247 nets, and a
160 by 90 mm board. The archive README gives third-party 3D-model ownership
notes but no license for the PCB design. Therefore neither the archive nor a
derived packaged fixture is redistributed here pending a clear grant.

Raspberry Pi's `raspberrypi/hats` repository publishes the HAT electrical and
mechanical specification under BSD-3-Clause, but it is a specification rather
than an actual product PCB. The actual [Hat Labs Sailor Hat](https://github.com/hatlabs/SH-RPi-hardware)
was pinned at commit `e82e3c9823bbcf94091b22927dd2e0da9cdfac8c`; its PCB SHA-256 is
`d13c9adb68b25b2253ef61015362ed4f836d6d3488cd3e308427c239c1edc0ae`.
The PCB title block identifies Hat Labs Ltd and CC BY 4.0, matching the full
repository `LICENSE.md`. No synthetic rectangle or template was labelled as a
Raspberry Pi or HAT in this acceptance work.

## Local CM4IO plus Sailor Hat run

`scripts/build_rpi_hat_acceptance.py` consumes the exact locally downloaded
CM4IO archive and pinned Sailor Hat checkout. It fails closed on either digest.
The output stays in ignored `build/rpi-hat-acceptance-20261002`; because the
CM4IO PCB grant is unclear, the generated package is local evidence and must
not be copied into public examples or distributions.

The saved `cm4io-sailor-hat.spike` contains the actual distinct boards: CM4IO
151 components/944 pads/247 nets and Sailor Hat 168/540/118. Its proper rigid
frame applies a 180 degree Y rotation and translation `(200.5, 67.55, 14)` mm,
derived from the actual J8/J501 through-hole centers. It aligns physical GPIO
header pins 2 (5 V), 3 (SDA), and 6 (GND) within `1.5e-14` mm in XY at a 14 mm
Z gap, retaining design-local equal-name `GND` nets before the mate.
`placement-evidence.json` records all three checks and unchanged source
coordinates. The final recorded rerun manifest payload SHA-256 is
`f59e3d5bc38b37510682e0bfa599809185807df70a49e0961d36485c40962439`.

| Path | Local observed result |
| --- | --- |
| PI | completed; assumed 5 V source and 12.5 ohm HAT load produced 1.992342 W load power and 1.91265 mW loss in each assumed 12 milliohm supply/return contact |
| SI | completed 17-point 1 kHz to 10 MHz SDA reduced AC sweep with assumed 25 milliohm/6 nH signal contact and 4.7 kohm load |
| Thermal/radiosity | completed; CM4IO 41.9201 C, HAT 49.3512 C at 25 C ambient, balance residual `-1.21e-11 W`, inter-board radiation magnitude 0.19905 W |
| Reduced EM | completed four frequencies; maximum assumed-loop induced HAT current 0.04866 A, normalized energy eigenvalue 0.8931, `field_coupling_executed=false` |

The PI/SI contact values, board powers, thermal resistances, emissivity, view
factors, standoff conductance, and magnetic R/L/M are explicit exploratory
assumptions. Full-wave coupled EM and far-field radiation remain explicitly
`unsupported` in the saved evidence. Correcting the physical board frames did
not change these reduced numerical results: the thermal view factors and loop
geometry are supplied assumptions rather than quantities extracted from the
placed artwork.

## Limits

This run proves source identity, conversion, package retention, explicit
connector isolation/mating, and execution of supported reduced paths. It does
not prove pin numbering parity beyond the explicitly recorded mappings,
mechanical collision clearance, connector parasitics, relay operating power,
thermal boundary calibration, SI bandwidth, radiated emissions, or general
coupled PCB field accuracy. Knowledgeable review remains required before using
the numerical assumptions for hardware decisions.
