# Raspberry Pi CM4 IO Board and Sailor Hat

This curated local example uses the exact Raspberry Pi Compute Module 4 IO
Board v5 KiCad PCB and Hat Labs Sailor Hat at commit
`e82e3c9823bbcf94091b22927dd2e0da9cdfac8c`. It is a CM4 IO carrier plus a
third-party HAT, not a model of the Raspberry Pi SBC or Compute Module itself.
The generated directory and `.spike` package do not copy either third-party CAD
source. Source hashes, attribution, and the local-only licensing boundary are
recorded in `source-provenance.json`.

## Rebuild

Use the reviewed local inputs; no download is required:

```powershell
.venv\Scripts\python.exe scripts\build_rpi_hat_acceptance.py `
  --output-dir build\curated-multiboard-20261005\raspberry-pi `
  --source-dir build\rpi-hat-acceptance-20261002\sources\SH-RPi-hardware
```

The builder verifies the official CM4 IO archive SHA-256, Sailor Hat Git commit
and PCB SHA-256, imports 151/944/247 and 168/540/118
components/pads/nets respectively, and aligns J8 to J501 with a proper 180
degree Y rotation and 14 mm separation. Only pins 2 (5 V), 3 (SDA), and 6
(return) are explicitly mated. Equal names such as GND remain board-local until
that saved mapping connects them.

## Recorded desktop steps

1. Open `build/curated-multiboard-20261005/raspberry-pi/cm4io-sailor-hat.spike`.
2. Choose **Multi-board**, then inspect **Boards** and **Mechanics**. Confirm the
   two exact occurrences and the 14 mm connector-aligned stack.
3. Open **Links & harnesses**. Confirm the `gpio-header-mate` mapping contains
   J8/J501 pins 2, 3, and 6, and `gpio-standoffs` is the thermal contact.
4. Open **Coupled studies**. PI opens first after a project reopen. Its saved
   setup and completed result are already available; select SI or Thermal to
   inspect their separately retained setup and result. **Run** repeats the
   selected actual reduced-model solve; **Save with results** replaces its
   manifest-bound result.
5. For PI, inspect the 5 V source, 12.5 ohm HAT load, 0.012 ohm pin 2/6 links,
   and explicit J8:6 reference. The actual HAT load result is
   1.9923420619353869 W; the independent series-circuit oracle differs by
   1.15e-11 relative.
6. For SI, inspect the 1 kHz to 10 MHz, 17-point logarithmic AC sweep, 4700 ohm
   load, pin 3 path (0.025 ohm, 6 nH), pin 6 path (0.012 ohm, 3 nH), and the
   explicit 1 Mohm bias paths. Differential HAT response is
   0.9999921277 - j1.2031e-8 V at 1 kHz and
   0.9999921132 - j1.203144e-4 V at 10 MHz. A closed-form complex divider agrees
   within 4.45e-16 V.
7. For Thermal, inspect 25 C ambient, 2.5 W CM4 IO board power, PI-derived
   1.9923420619353869 W HAT power, 9 and 16 C/W ambient resistances, 0.035 W/K
   contact conductance, and explicit diffuse-gray view factors. The solve gives
   41.920106 C and 49.351231 C. Its steady energy residual is
   1.22e-11 W and radiation closure residual is 6.67e-16 W.

## Evidence and limits

`acceptance-evidence.json` records the independent PI and SI oracles and thermal
conservation checks. Request/result sidecars record complete inputs and actual
outputs. The `.spike` package retains all three requests and results under
Coupled studies; reopening and hydrating it was checked after generation.

These are experimental or approximate reduced networks with user-supplied
component, connector, contact, and radiation parameters. Board artwork is not
used to extract a complete circuit, distributed channel, airflow, or spatial
thermal field. No full-wave EM, radiation, EMI compliance, hardware
correlation, or production qualification is claimed.
