/**
 * A toolbar that collapses into an overflow menu instead of clipping.
 *
 * The header is a single flex row, and at narrow widths it simply ran out of room — the mode
 * buttons lost their labels and the keyboard hint was sliced mid-word. Hiding things at CSS
 * breakpoints would fix the clipping and lose the controls; this moves them somewhere they
 * can still be reached.
 *
 * **The controls are moved, not cloned.** Every one of them is wired up by id in `main.ts`,
 * so a copy would be a dead button that looks live — the worst possible failure for a
 * toolbar. Moving the real node keeps its listeners, its id, its `disabled` state and its
 * `.explorer-only` class, which means stage visibility keeps working inside the menu too.
 *
 * The packing decision is a pure function so it can be tested without a layout engine; the
 * DOM part is only measuring and appending.
 */

export interface ToolbarItem {
  readonly id: string;
  /** Measured width in pixels. Zero for an item the current stage hides. */
  readonly width: number;
  /** Lower collapses first. Ties break towards the later item in the array. */
  readonly priority: number;
}

/**
 * Which items to move into the overflow menu, lowest priority first.
 *
 * Returns ids rather than indices so the caller cannot mis-map them back, and so a test reads
 * as the sentence it is checking.
 *
 * Zero-width items are never chosen: they are hidden by the current stage and moving them
 * would put an invisible entry in the menu that appears from nowhere when the stage changes.
 */
export function chooseOverflow(
  items: readonly ToolbarItem[],
  available: number,
  gap: number,
  overflowButtonWidth: number,
): string[] {
  const visible = items.filter((i) => i.width > 0);
  const total = (list: readonly ToolbarItem[]): number =>
    list.reduce((sum, i) => sum + i.width, 0) + Math.max(0, list.length - 1) * gap;

  if (total(visible) <= available) return [];

  // Collapse in priority order. The overflow button costs width itself, so it is included
  // from the first move onwards — otherwise the last item moved can leave the bar one button
  // too wide and the whole exercise achieves nothing.
  const order = [...visible].sort((a, b) => a.priority - b.priority);
  const moved: string[] = [];
  let kept = visible;

  for (const candidate of order) {
    // Stop before the bar is empty, not after. The highest-priority control — Run — stays
    // put at any width; a toolbar showing nothing but a "⋯" is a worse answer than a
    // toolbar that overflows, and at that point the menu is the whole interface.
    if (kept.length <= 1) break;
    if (total(kept) + gap + overflowButtonWidth <= available) break;
    moved.push(candidate.id);
    kept = kept.filter((i) => i.id !== candidate.id);
  }
  return moved;
}

export interface Toolbar {
  /** Re-measure and repack. Safe to call often; does nothing when the layout has not moved. */
  refresh(): void;
}

/**
 * Wire the header up.
 *
 * `items` names the controls **in the order they appear on screen**, with the priority each
 * collapses at. That ordering is load-bearing: repacking puts every control back into the bar
 * in this array's order, so listing them by priority instead quietly rearranges the whole
 * toolbar the first time the window is resized.
 *
 * The brand and the overflow button itself are not in the list — they never move.
 */
export function createToolbar(
  header: HTMLElement,
  spacer: HTMLElement,
  items: readonly { readonly id: string; readonly priority: number }[],
): Toolbar {
  const more = document.createElement('button');
  more.id = 'btn-more';
  more.className = 'tb-more';
  more.type = 'button';
  more.textContent = '⋯';
  more.title = 'Controls that do not fit';
  more.hidden = true;
  more.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'tb-menu';
  menu.hidden = true;

  header.append(more, menu);

  const nodes = items
    .map((item) => ({ ...item, node: document.getElementById(item.id) }))
    .filter((item): item is typeof item & { node: HTMLElement } => item.node !== null);

  function closeMenu(): void {
    menu.hidden = true;
    more.setAttribute('aria-expanded', 'false');
  }

  more.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    more.setAttribute('aria-expanded', String(!menu.hidden));
  });

  // Any control inside the menu does its job and then gets out of the way. Without this the
  // menu sits over the stage after every click, which is exactly the sort of thing that makes
  // an overflow menu feel worse than the clipping it replaced.
  menu.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) closeMenu();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== more) closeMenu();
  });

  let packing = false;

  function refresh(): void {
    // Mutating the DOM is what a ResizeObserver watches for, so without this guard the first
    // repack schedules a second one for ever.
    if (packing) return;
    packing = true;

    // Everything home first, so widths are measured in the layout they will actually have.
    for (const item of nodes) header.insertBefore(item.node, spacer);
    more.hidden = true;

    const measured = nodes.map((item) => ({
      id: item.id,
      priority: item.priority,
      width: item.node.offsetWidth,
    }));

    const style = getComputedStyle(header);
    const gap = parseFloat(style.columnGap || style.gap || '0') || 0;
    // What is left for the controls once the brand and the header's own padding are taken.
    let used = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    for (const child of header.children) {
      if (child === spacer || child === menu || child === more) continue;
      if (!nodes.some((n) => n.node === child)) used += (child as HTMLElement).offsetWidth + gap;
    }
    const available = header.clientWidth - used;

    const overflowed = new Set(chooseOverflow(measured, available, gap, more.offsetWidth || 32));

    for (const item of nodes) {
      if (overflowed.has(item.id)) menu.append(item.node);
    }
    more.hidden = overflowed.size === 0;
    if (more.hidden) closeMenu();

    packing = false;
  }

  refresh();
  new ResizeObserver(() => refresh()).observe(header);
  return { refresh };
}
