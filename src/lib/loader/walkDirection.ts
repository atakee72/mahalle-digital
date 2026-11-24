// Which way the page-change beetle walks (src/components/KioskLoader.astro). Pure rules, no DOM.
//
// The nav bar is the map: a target further right walks right, further left walks left. A page
// inside a section counts as that section. Inside one section, going deeper walks right and
// going back up walks left. Where the nav bar has no answer (profile, search, …), the beetle
// walks right, and left when the member used the browser's back button.

export type WalkDirection = 'left' | 'right';

// Nav bar order, left to right (KioskNav). Each section owns its index page and its detail routes.
const SECTIONS: readonly (readonly string[])[] = [
  ['/forum', '/topics', '/announcements', '/recommendations'],
  ['/calendar', '/events'],
  ['/newsboard'],
  ['/marketplace'],
  ['/schillerkiez'],
  ['/blog'],
];

const clean = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path);
const depth = (path: string) => clean(path).split('/').filter(Boolean).length;

/** Position of the path's section in the nav bar, or -1 when it has none. */
export function sectionIndex(path: string): number {
  const p = clean(path);
  return SECTIONS.findIndex((prefixes) => prefixes.some((pre) => p === pre || p.startsWith(pre + '/')));
}

export function walkDirection(fromPath: string, toPath: string, isBack: boolean): WalkDirection {
  const from = sectionIndex(fromPath);
  const to = sectionIndex(toPath);
  if (from !== -1 && to !== -1 && from !== to) return to > from ? 'right' : 'left';
  if (isBack) return 'left';
  if (from !== -1 && from === to && depth(toPath) < depth(fromPath)) return 'left';
  return 'right';
}
