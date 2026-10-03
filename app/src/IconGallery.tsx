// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { Search, X, workbenchIconInventory, type WorkbenchIconCategory } from "./icons";
import "./IconGallery.css";

export default function IconGallery({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"All" | WorkbenchIconCategory>("All");
  const categories = useMemo(() => ["All", ...new Set(workbenchIconInventory.map(item => item.category))] as const, []);
  const needle = query.trim().toLowerCase();
  const icons = workbenchIconInventory.filter(item => (category === "All" || item.category === category)
    && (!needle || `${item.name} ${item.description} ${item.category}`.toLowerCase().includes(needle)));
  return <div className="modal-shade icon-gallery-shade">
    <section className="icon-gallery" role="dialog" aria-modal="true" aria-labelledby="icon-gallery-title" onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}>
      <header><div><small>SPIKE DESIGN SYSTEM</small><h2 id="icon-gallery-title">Workbench icon gallery</h2></div><button onClick={onClose} aria-label="Close icon gallery" title="Close"><X size={17} /></button></header>
      <div className="icon-gallery-tools">
        <label><Search size={15} /><input type="search" aria-label="Search icons and meanings" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search icons and meanings" autoFocus /></label>
        <select aria-label="Filter icon category" value={category} onChange={event => setCategory(event.target.value as typeof category)}>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select>
        <span>{icons.length} of {workbenchIconInventory.length}</span>
      </div>
      <div className="icon-gallery-grid">
        {icons.map(({ name, description, category: iconCategory, icon: Icon }) => <article key={name} title={`${description} (${iconCategory})`}>
          <Icon size={30} aria-label={description} />
          <div><b>{name}</b><span>{description}</span><small>{iconCategory}</small></div>
        </article>)}
        {!icons.length && <p className="icon-gallery-empty">No icons match this search.</p>}
      </div>
      <footer>Original SPIKE 24 x 24 line artwork. Generic names outside this inventory use the local Lucide compatibility fallback.</footer>
    </section>
  </div>;
}
