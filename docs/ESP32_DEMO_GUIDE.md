# Show SPIKE in 60–90 seconds

Use this walkthrough for a live demonstration or a short video: import an
ESP32 board, inspect its thermal overlay, and explore its EMerge antenna
radiation pattern. This is a recording guide, not a published video.

## Prepare the workspace

Complete the [ESP32 quickstart](ESP32_QUICKSTART.md) once before recording.
Keep the source board and both saved result files ready. Rehearse switching
between **Thermal** and **EM**, and check that probe readouts are legible.
Use a clean recording area without personal paths or unrelated windows.

Show the saved results as saved results. Keep the displayed frequency, units,
and model labels visible. Leave download and installation outside the clip.

## Recording sequence

| Time | What to show | Suggested narration |
| --- | --- | --- |
| 0–10 s | Title, then **Import** the supplied ESP32 KiCad board. | “SPIKE brings PCB power, signal, thermal, and electromagnetic analysis into one desktop workspace.” |
| 10–25 s | **Fit**, switch from **2D** to **3D**, then orbit toward the antenna. | “Start with a KiCad board and inspect its copper, components, and antenna geometry.” |
| 25–45 s | **Thermal → 3D → Open saved**, select the thermal bundle, enable **Field**, and click a cell. | “Here is a saved thermal study. I can inspect temperatures directly on the board and probe individual layers.” |
| 45–70 s | **EM → EMerge → Open saved radiation result**, select the saved result, then **Board + pattern** at **2.450 GHz**. Orbit and click the pattern. | “This antenna pattern was solved with the EMerge extension. SPIKE displays its relative shape beside the board, with angular probes and 2D plots.” |
| 70–85 s | Briefly show a 2D cut, then return to the board and pattern. | “This example uses assumed thermal inputs and a simplified antenna model. Try it yourself and share what works—or what needs improving.” |
| 85–90 s | End card with the repository and release links. | “Download SPIKE and follow the ESP32 walkthrough.” |

For a 60-second cut, shorten the opening and board orbit and omit the 2D plot
detour. Give the probe values enough time to be read. If file dialogs or loading
take longer, trim those pauses and describe the clip as edited.

## Details worth keeping on screen

- Thermal: show the temperature unit and note that the example uses assumed
  component powers totaling 1.35 W.
- Antenna: show **2.450 GHz**, **relative dB**, and the simplified-model label.
  The rendered radius is a display scale, not a distance or absolute gain.
- Missing 3D component models: describe visible substitutes as placeholders.

The [full example](../examples/esp32/README.md) explains the model settings and
omissions. Use its details when answering questions about the results.

## Caption to adapt when the video is ready

> A quick look at SPIKE: import an ESP32 KiCad board, probe a saved thermal
> study, and explore an EMerge antenna radiation pattern in the 3D viewport.
> These examples use assumed thermal inputs and a simplified antenna model.
> Try the walkthrough and tell us how the results and workflow compare with
> your usual tools.

Link the caption to the [quickstart](ESP32_QUICKSTART.md) and the
[release](https://github.com/wayri/SPIKE-Main/releases/tag/v0.3.0). Add the video
link beside the README walkthrough when it is published.
