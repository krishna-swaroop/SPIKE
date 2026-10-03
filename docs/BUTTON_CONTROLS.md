# Button and control standard

SPIKE desktop controls use `app/src/buttonStandard.css`. The application entry
point and every first party Vite preview with interactive controls must import
that stylesheet. It reuses `tableTheme.css`, so controls follow professional
dark, light, system, and high contrast palettes.

## Baseline

Native buttons, button-like inputs, text fields, selects, text areas, and
elements with `role="button"` receive an explicit font, minimum height, padding,
border, surface, text color, pointer state, disabled state, and keyboard focus
ring. File picker buttons and checkbox, radio, and range accents also use the
theme. Shared geometry and state selectors use `:where(...)` and therefore have
zero specificity. The font reset uses ordinary element specificity so it wins
the older global inherited-font rule. A scoped component class can still define
necessary typography or geometry without resetting the common interaction
states.

Use a semantic `<button type="button">` whenever possible. A non-native
`role="button"` must also implement keyboard activation, focusability, and
`aria-disabled` behavior in its component.

## Variants

Use either the class or equivalent `data-spike-control` value:

- `spike-control--primary`: the main commit or run action in a surface.
- `spike-control--danger`: a destructive action after its workflow has applied
  the required confirmation or recovery behavior.
- `spike-control--compact`: a dense text control with a 24 px minimum height.
- `spike-control--icon`: a square icon control. It still needs an accessible
  name through visible text, `aria-label`, or `title` where appropriate.
- `spike-control--bare`: removes the surface and spacing for a deliberate
  embedded control while retaining focus and disabled behavior.

Existing icon buttons, ribbon cells, editor gutters, table controls, viewport
gestures, and dock tabs are deliberate specialized variants. Their scoped
styles may override size, layout, border, and background. They must preserve a
visible `:focus-visible` state, disabled behavior, and theme-readable text.

## Guard and boundaries

Run `npm run test:button-standard` from `app`. The guard verifies application
entrypoint coverage, checks every first party `scripts/*preview.tsx` containing
a button for the shared import, and validates the required states and token-only
control rules.

Generated engineering report and print HTML is a separate document with
self-contained report CSS. Third party web content is outside the SPIKE style
boundary. Neither may be rewritten to import application CSS. Canvas and SVG
gesture targets are checked by their owning interaction tests; when they expose
`role="button"`, their component remains responsible for keyboard activation.
