// SPDX-License-Identifier: Apache-2.0
/** Human-readable values from the visible page, including current unsaved editor values. */
export function displayedCell(cell: Element): string {
  const field = cell.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type=hidden]):not([type=password]),textarea,select");
  if (field) {
    if (field instanceof HTMLInputElement && ["checkbox", "radio"].includes(field.type)) return String(field.checked);
    return field.value;
  }
  return (cell.textContent ?? "").trim();
}
export function displayedRow(row: HTMLTableRowElement): string[] { return [...row.cells].map(displayedCell); }
export function displayedTableContext(table: HTMLTableElement, row: HTMLTableRowElement | null, label: string, scope: "row" | "page", page: number, totalRows: number): unknown {
  const rows = scope === "row" ? row ? [row] : [] : [...table.querySelectorAll<HTMLTableRowElement>("tbody tr")];
  if (rows.length > 500) throw new Error("This visible page exceeds the 500-row script snapshot limit. Select a row or use source export; no rows were truncated.");
  return { label, representation: "Displayed strings and current editor values; formatting and units are retained in headings. This is not a canonical source export.",
    scope, page: page + 1, total_matching_rows: totalRows, columns: [...table.querySelectorAll("thead th")].map(cell => (cell.textContent ?? "").trim()), rows: rows.map(displayedRow) };
}
