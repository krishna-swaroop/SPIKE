// SPDX-License-Identifier: MIT
// Snapshot the active Tauri ribbon and menu labels for the native experiment.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const React = require('../app/node_modules/react');
const { renderToStaticMarkup } = require('../app/node_modules/react-dom/server');
const lucide = require('../app/node_modules/lucide-react');
const ts = require('../app/node_modules/typescript');
const root = path.resolve(import.meta.dirname, '..');
const app = fs.readFileSync(path.join(root, 'app/src/App.tsx'), 'utf8');
const between = (start, end) => {
  const first = app.indexOf(start);
  const last = app.indexOf(end, first + start.length);
  if (first < 0 || last < 0) throw new Error(`Tauri UI marker missing: ${start} / ${end}`);
  return app.slice(first, last);
};
const tabSource = between('const tabs:', 'const initialLayers:');
const tabs = [...tabSource.matchAll(/\{ name: "([^"]+)", icon: (\w+) \}/g)]
  .map(([, tab, icon]) => ({ tab, icon }));
if (!tabs.length) throw new Error('No Tauri ribbon tabs were found');
const ribbon = [];
const overrides = {};
const iconMap = app.slice(app.indexOf('const toolIconByLabel:'), app.indexOf('function Tool(', app.indexOf('const toolIconByLabel:')));
for (const match of iconMap.matchAll(/(?:"([^"]+)"|(\w+)):\s*(\w+)\s*,/g)) overrides[match[1] || match[2]] = match[3];
for (const match of iconMap.matchAll(/^\s*(\w+)\s*,\s*$/gm)) overrides[match[1]] = match[1];
const ribbonSource = between('const ribbonContent = (() => {', 'const universalSearchItems');
const cases = [...ribbonSource.matchAll(/case "([^"]+)":/g)];
for (let index = 0; index < cases.length; index++) {
  const tab = cases[index][1];
  const section = ribbonSource.slice(cases[index].index, cases[index + 1]?.index ?? ribbonSource.length);
  const groups = [...section.matchAll(/<ToolGroup label="([^"]+)"[^>]*>([\s\S]*?)<\/ToolGroup>/g)]
    .map(([, label, content]) => ({
      label,
      dynamic: /activeToolbarExtension|toolbarContributions|toolbarExtensions/.test(content),
      tools: [...content.matchAll(/<Tool icon=\{(\w+)\} label=(?:"([^"]+)"|\{([^}]+)\})/g)]
        .map(([, icon, fixed, dynamic]) => {
          const label = fixed || dynamic?.match(/"([^"]+)"/)?.[1] || '';
          return { icon: overrides[label] || icon, label };
        })
        .filter(tool => tool.label),
    }))
    .filter(group => group.tools.length || group.label === 'AVAILABLE CAPABILITIES');
  if (tab === 'Home' && groups.length > 3) groups.splice(3);
  const replace = (from, to) => {
    for (const group of groups) for (const tool of group.tools) {
      if (tool.label === from) { tool.label = to; tool.icon = overrides[to] || tool.icon; }
    }
  };
  if (tab === 'Solve') { replace('si', 'Run controls'); replace('Stopping...', 'Stop'); }
  if (tab === 'PI') replace('Running...', 'Run PI');
  if (tab === 'EM') replace('Screening', 'Risk screen');
  ribbon.push({ tab, groups });
}
const menus = [];
const menuSection = between('<nav className="menu-bar"', '</nav>');
const menuPattern = /<MenuButton label=(?:\{tr\("([^"]+)"\)\}|"([^"]+)")[^>]*>([\s\S]*?)<\/MenuButton>/g;
for (const match of menuSection.matchAll(menuPattern)) {
  const label = match[1] || match[2];
  const items = [...match[3].matchAll(/<MenuItem[^>]*?icon=\{(\w+)\}[^>]*?label="([^"]+)"(?:\s+shortcut="([^"]+)")?/g)]
    .map(([, icon, item, shortcut]) => ({ label: item, icon, ...(shortcut ? { shortcut } : {}) }));
  if (items.length) menus.push({ label, items });
}
const view = menus.find(menu => menu.label === 'View');
if (view) {
  view.items.unshift({ label: 'Minimize command ribbon', icon: 'PanelTop' });
  view.items.splice(3, 0, { label: 'Show net names', icon: 'Route' });
}
const manifest = {
  reference: 'app/src/App.tsx',
  css: 'app/src/styles.css',
  sourceDigest: createHash('sha256').update(tabSource + ribbonSource + menuSection).digest('hex'),
  tabs: tabs.map(({ tab, icon }) => ({ tab, icon, groups: ribbon.find(item => item.tab === tab)?.groups ?? [] })),
  menus,
  boardView: [
    ['2D', 'MapPinPlus'], ['3D', 'Cuboid'], ['Layers', 'GalleryVertical'],
    ['Models', 'Boxes'], ['Translucent', 'Blend'], ['Fit', 'Focus'],
    ['Top', 'PanelTop'], ['Bottom', 'PanelBottom'], ['Iso', 'Axis3D'],
  ].map(([label, icon]) => ({ label, icon })),
};
// Preserve source command identity and state predicates, not just its label.
// These become the client adapter inventory and distinguish repeated labels
// such as "Settings" in different workspaces.
const sourceFile = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const controls = [];
const attributes = node => Object.fromEntries(node.attributes.properties
  .filter(ts.isJsxAttribute).map(attribute => {
    const value = attribute.initializer;
    return [attribute.name.getText(sourceFile), !value ? 'true'
      : ts.isStringLiteral(value) ? value.text
      : ts.isJsxExpression(value) ? value.expression?.getText(sourceFile) ?? '' : value.getText(sourceFile)];
  }));
const visit = node => {
  if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
    const name = node.tagName.getText(sourceFile);
    if (['Tool', 'MenuItem'].includes(name)) controls.push({
      kind: name, start: node.getStart(sourceFile), ...attributes(node),
      sourceLine: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    });
  }
  ts.forEachChild(node, visit);
};
visit(sourceFile);
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const used = new Set();
const enrich = (item, prefix, source) => {
  let id = `${prefix}/${slug(item.label)}`;
  for (let suffix = 2; used.has(id); suffix++) id = `${prefix}/${slug(item.label)}-${suffix}`;
  used.add(id); item.id = id;
  if (source) {
    item.sourceLine = source.sourceLine;
    item.handler = source.onClick ?? '';
    item.disabledWhen = source.disabled ?? 'false';
    item.activeWhen = source.active ?? 'false';
    item.labelExpression = source.label;
    const navigation = item.handler.match(/^\(\) => setTab\("([^"]+)"\)$/);
    if (navigation) item.targetWorkspace = navigation[1];
  }
};
const ribbonStart = app.indexOf('const ribbonContent = (() => {');
const menuStart = app.indexOf('<nav className="menu-bar"');
for (const tab of manifest.tabs) {
  const caseIndex = cases.findIndex(match => match[1] === tab.tab);
  const first = ribbonStart + (cases[caseIndex]?.index ?? 0);
  const last = ribbonStart + (cases[caseIndex + 1]?.index ?? ribbonSource.length);
  const candidates = controls.filter(control => control.kind === 'Tool' && control.start >= first && control.start < last);
  for (const group of tab.groups) for (const tool of group.tools) {
    const source = candidates.find(control => control.label === tool.label)
      ?? candidates.find(control => control.label?.includes(`"${tool.label}"`));
    enrich(tool, `ribbon/${slug(tab.tab)}/${slug(group.label)}`, source);
  }
}
for (const menu of manifest.menus) for (const item of menu.items) {
  enrich(item, `menu/${slug(menu.label)}`, controls.find(control => control.kind === 'MenuItem'
    && control.start >= menuStart && control.start < menuStart + menuSection.length && control.label === item.label));
}
for (const item of manifest.boardView) enrich(item, 'board', null);
fs.writeFileSync(path.join(import.meta.dirname, 'ui_manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const icons = new Set([...tabs.map(item => item.icon), ...manifest.boardView.map(item => item.icon)]);
for (const icon of ['Search', 'Bell', 'CircleHelp', 'MousePointer2', 'Component', 'Crosshair',
  'Orbit', 'Hand', 'Move3D', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ZoomIn', 'ZoomOut', 'ListTree', 'Play']) icons.add(icon);
for (const tab of manifest.tabs) for (const group of tab.groups) for (const tool of group.tools) icons.add(tool.icon);
for (const menu of menus) for (const item of menu.items) icons.add(item.icon);
const iconDir = path.join(import.meta.dirname, 'assets/icons');
fs.mkdirSync(iconDir, { recursive: true });
for (const icon of icons) {
  const component = lucide[icon];
  if (!component) continue;
  let svg = renderToStaticMarkup(React.createElement(component, { size: 24, strokeWidth: 1.8 }));
  svg = svg.replaceAll('currentColor', '#a9bac3');
  fs.writeFileSync(path.join(iconDir, `${icon}.svg`), svg + '\n');
}
fs.copyFileSync(path.join(root, 'app/public/spike-mark.svg'), path.join(import.meta.dirname, 'assets/spike-mark.svg'));
fs.writeFileSync(path.join(import.meta.dirname, 'assets/NOTICE.txt'),
  'Icons generated from lucide-react 0.468.0, ISC license (see LUCIDE_LICENSE.txt).\n' +
  'SPIKE mark copied from the current app/public/spike-mark.svg in this repository.\n');
fs.copyFileSync(path.join(root, 'app/node_modules/lucide-react/LICENSE'),
  path.join(import.meta.dirname, 'assets/LUCIDE_LICENSE.txt'));
console.log(`Extracted ${manifest.tabs.length} tabs, ${menus.length} menus and ${icons.size} icon names.`);
