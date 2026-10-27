import type { Native44VisualControl, Native44VisualModule, Native44VisualPaint, Native44VisualText } from './contracts.js';

export const visualTextKey = (value: string): string => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();

function color(value: string): string {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i.exec(value);
  if (!match) return value.trim().toLowerCase();
  return `${Number(match[1])},${Number(match[2])},${Number(match[3])},${match[4] === undefined ? 1 : Number(match[4])}`;
}

export function opaqueSolidBackground(style: Record<string, string> | undefined): string | null | undefined {
  if (!style || style['background-image'] && style['background-image'] !== 'none') return null;
  const value = style['background-color'] ?? '';
  if (!value || value === 'transparent') return undefined;
  const parsed = color(value).split(',');
  if (parsed.length !== 4) return null;
  return Number(parsed[3]) === 1 ? value : Number(parsed[3]) === 0 ? undefined : null;
}

function pixels(value: string): number | null {
  if (!/^-?\d+(?:\.\d+)?px$/.test(value.trim())) return null;
  return Number.parseFloat(value);
}

export function visualBackgroundImageKind(value: string): Native44VisualPaint['backgroundImage'] {
  return !value || value === 'none' ? 'none' : /gradient\(/i.test(value) ? 'gradient' : 'image';
}

export function visiblePaint(style: Record<string, string>): boolean {
  const background = style['background-color'] ?? '';
  const opaque = color(background).split(',');
  const borders = (style['border-width'] ?? '').match(/\d+(?:\.\d+)?px/g) ?? [];
  return opaque.length === 4 && Number(opaque[3]) > 0
    || visualBackgroundImageKind(style['background-image'] ?? '') !== 'none'
    || borders.some(value => Number.parseFloat(value) > 0) && (style['border-style'] ?? '') !== 'none'
    || !!style['box-shadow'] && style['box-shadow'] !== 'none';
}

/** Match by the painted rectangle, so class names and DOM nesting may differ. */
export function compareVisualPaintLayers(source: Native44VisualPaint[], target: Native44VisualPaint[]): string[] {
  const differences: string[] = [], remaining = new Set(target.map((_, index) => index));
  for (const item of source) {
    let closest = -1, distance = Infinity;
    for (const index of remaining) {
      const other = target[index];
      const score = Math.abs(item.x - other.x) + Math.abs(item.y - other.y) + Math.abs(item.width - other.width) + Math.abs(item.height - other.height)
        + (color(item.background) === color(other.background) ? 0 : 2)
        + (item.backgroundImage === other.backgroundImage ? 0 : 2);
      if (score < distance) { closest = index; distance = score; }
    }
    if (closest < 0 || distance > Math.max(24, (item.width + item.height) * .08)) {
      differences.push(`painted region missing or displaced at (${Math.round(item.x)}, ${Math.round(item.y)}) ${Math.round(item.width)}×${Math.round(item.height)}`);
      continue;
    }
    remaining.delete(closest);
    const other = target[closest], changed: string[] = [];
    for (const dimension of ['x', 'y', 'width', 'height'] as const) if (Math.abs(item[dimension] - other[dimension]) > Math.max(dimension === 'x' || dimension === 'y' ? 8 : 4, item[dimension] * .02)) changed.push(dimension);
    if (color(item.background) !== color(other.background)) changed.push('background');
    if (item.backgroundImage !== other.backgroundImage) changed.push('background image/gradient');
    const bordered = (value: Native44VisualPaint) => (value.borderWidth.match(/\d+(?:\.\d+)?px/g) ?? []).some(width => Number.parseFloat(width) > 0);
    if (bordered(item) !== bordered(other) || bordered(item) && (item.borderWidth !== other.borderWidth || color(item.borderColor) !== color(other.borderColor))) changed.push('border');
    const circle = (value: Native44VisualPaint) => value.borderRadius.trim() === '50%' || (pixels(value.borderRadius) ?? -1) >= Math.min(value.width, value.height) / 2;
    if (item.borderRadius !== other.borderRadius && !(circle(item) && circle(other))) changed.push('radius');
    if (item.boxShadow !== other.boxShadow) changed.push('shadow');
    if (item.opacity !== other.opacity) changed.push('opacity');
    if (changed.length) differences.push(`painted region at (${Math.round(item.x)}, ${Math.round(item.y)}): ${changed.join(', ')}`);
  }
  for (const index of remaining) differences.push(`unexpected painted region at (${Math.round(target[index].x)}, ${Math.round(target[index].y)})`);
  return differences.slice(0, 30);
}

function diffControl(source: Native44VisualControl, target: Native44VisualControl): string[] {
  const problems: string[] = [];
  if (color(source.background) !== color(target.background)) problems.push(`control background ${source.background} -> ${target.background}`);
  if (color(source.color) !== color(target.color)) problems.push(`control color ${source.color} -> ${target.color}`);
  for (const key of ['width', 'height'] as const) if (Math.abs(source[key] - target[key]) > Math.max(3, source[key] * (key === 'width' ? .12 : .08))) problems.push(`control ${key} ${source[key]} -> ${target[key]}`);
  const underline = (control: Native44VisualControl) => ({ border: pixels(control.borderBottomWidth) ?? 0, pseudo: [control.beforeContent, control.afterContent].some(value => value !== 'none' && value !== 'normal' && value !== '') });
  const a = underline(source), b = underline(target);
  if (a.border !== b.border || a.pseudo !== b.pseudo) problems.push('control underline construction differs');
  return problems;
}

/** Only unique, unchanged copy is compared. Dynamic product/post copy can differ. */
export function compareNative44VisualModules(source: Native44VisualModule, target: Native44VisualModule, includePaint = false, includeTextLayout = false): Array<{ text?: string; detail: string }> {
  const differences: Array<{ text?: string; detail: string }> = [];
  if (includePaint && source.paintLayers && target.paintLayers) for (const detail of compareVisualPaintLayers(source.paintLayers, target.paintLayers)) differences.push({ detail });
  if (source.solidBackground && target.solidBackground && color(source.solidBackground) !== color(target.solidBackground)) differences.push({ detail: `effective section background ${source.solidBackground} -> ${target.solidBackground}` });
  if (source.progress || target.progress) {
    const a = source.progress ?? [], b = target.progress ?? [];
    if (a.length !== b.length) differences.push({ detail: `carousel progress count ${a.length} -> ${b.length}` });
    else for (let index = 0; index < a.length; index++) {
      const problems: string[] = [];
      if (Math.abs(a[index].width - b[index].width) > Math.max(4, a[index].width * .03)) problems.push(`width ${a[index].width} -> ${b[index].width}`);
      if (Math.abs(a[index].height - b[index].height) > 1) problems.push(`height ${a[index].height} -> ${b[index].height}`);
      if (Math.abs(a[index].x - b[index].x) > 8) problems.push(`horizontal position ${a[index].x} -> ${b[index].x}`);
      if (color(a[index].background) !== color(b[index].background)) problems.push(`background ${a[index].background} -> ${b[index].background}`);
      if (a[index].fillFraction !== null && b[index].fillFraction !== null && Math.abs(a[index].fillFraction! - b[index].fillFraction!) > .07) problems.push(`fill fraction ${a[index].fillFraction} -> ${b[index].fillFraction}`);
      if (problems.length) differences.push({ detail: `carousel progress ${index + 1}: ${problems.join('; ')}` });
    }
  }
  if (source.arrows || target.arrows) {
    const a = source.arrows ?? [], b = target.arrows ?? [];
    for (const side of ['prev', 'next'] as const) {
      const left = a.filter(item => item.side === side), right = b.filter(item => item.side === side);
      if (left.length !== right.length) { differences.push({ detail: `carousel ${side} arrow count ${left.length} -> ${right.length}` }); continue; }
      for (let index = 0; index < left.length; index++) {
        const sourceArrow = left[index], targetArrow = right[index], problems: string[] = [];
        for (const dimension of ['x', 'width', 'height'] as const) if (Math.abs(sourceArrow[dimension] - targetArrow[dimension]) > (dimension === 'x' ? 10 : 3)) problems.push(`${dimension} ${sourceArrow[dimension]} -> ${targetArrow[dimension]}`);
        if (color(sourceArrow.background) !== color(targetArrow.background)) problems.push(`background ${sourceArrow.background} -> ${targetArrow.background}`);
        if (color(sourceArrow.color) !== color(targetArrow.color)) problems.push(`color ${sourceArrow.color} -> ${targetArrow.color}`);
        const circle = (radius: string, width: number, height: number) => radius.trim() === '50%' || (pixels(radius) ?? -1) >= Math.min(width, height) / 2;
        if (sourceArrow.borderRadius !== targetArrow.borderRadius && !(circle(sourceArrow.borderRadius, sourceArrow.width, sourceArrow.height) && circle(targetArrow.borderRadius, targetArrow.width, targetArrow.height))) problems.push(`radius ${sourceArrow.borderRadius} -> ${targetArrow.borderRadius}`);
        for (const dimension of ['iconWidth', 'iconHeight'] as const) if (sourceArrow[dimension] === null !== (targetArrow[dimension] === null) || sourceArrow[dimension] !== null && targetArrow[dimension] !== null && Math.abs(sourceArrow[dimension]! - targetArrow[dimension]!) > 3) problems.push(`${dimension} ${sourceArrow[dimension]} -> ${targetArrow[dimension]}`);
        if (problems.length) differences.push({ detail: `carousel ${side} arrow ${index + 1}: ${problems.join('; ')}` });
      }
    }
  }
  if (source.mediaGeometry || target.mediaGeometry) {
    const a = source.mediaGeometry ?? [], b = target.mediaGeometry ?? [];
    if (a.length <= 20 && b.length <= 20) {
      if (a.length !== b.length) differences.push({ detail: `visible image/icon count ${a.length} -> ${b.length}` });
      else for (let index = 0; index < a.length; index++) {
        const problems: string[] = [];
        for (const dimension of ['x', 'y', 'width', 'height'] as const) if (Math.abs(a[index][dimension] - b[index][dimension]) > (dimension === 'x' || dimension === 'y' ? 12 : 4)) problems.push(`${dimension} ${a[index][dimension]} -> ${b[index][dimension]}`);
        if (problems.length) differences.push({ detail: `visible image/icon ${index + 1}: ${problems.join('; ')}` });
      }
    }
  }
  const unique = (rows: Native44VisualText[]) => {
    const counts = new Map<string, number>();
    for (const row of rows) { const key = visualTextKey(row.text); counts.set(key, (counts.get(key) ?? 0) + 1); }
    return new Map(rows.filter(row => counts.get(visualTextKey(row.text)) === 1).map(row => [visualTextKey(row.text), row]));
  };
  const targetByText = unique(target.texts);
  for (const [key, a] of unique(source.texts)) {
    const b = targetByText.get(key); if (!b) continue;
    const problems: string[] = [];
    if (color(a.color) !== color(b.color)) problems.push(`text color ${a.color} -> ${b.color}`);
    const fontA = pixels(a.fontSize), fontB = pixels(b.fontSize);
    if (fontA !== null && fontB !== null && Math.abs(fontA - fontB) > 1) problems.push(`font size ${a.fontSize} -> ${b.fontSize}`);
    const lineA = pixels(a.lineHeight), lineB = pixels(b.lineHeight);
    if (lineA !== null && lineB !== null && Math.abs(lineA - lineB) > 2) problems.push(`line height ${a.lineHeight} -> ${b.lineHeight}`);
    if (includeTextLayout) {
      if (a.height === undefined || b.height === undefined || !a.whiteSpace || !b.whiteSpace) problems.push('rendered text layout evidence missing');
      else {
        if (Math.abs(a.height - b.height) > 3) problems.push(`text box height ${a.height} -> ${b.height}`);
        if (a.lineCount !== undefined && b.lineCount !== undefined && a.lineCount !== b.lineCount) problems.push(`rendered lines ${a.lineCount} -> ${b.lineCount}`);
        if ((a.whiteSpace === 'nowrap') !== (b.whiteSpace === 'nowrap')) problems.push(`white-space ${a.whiteSpace} -> ${b.whiteSpace}`);
      }
    }
    if (a.x !== undefined && b.x !== undefined && Math.abs(a.x - b.x) > 12) problems.push(`horizontal placement ${a.x} -> ${b.x}`);
    if (Boolean(a.control) !== Boolean(b.control)) problems.push('control semantics differ');
    else if (a.control && b.control) problems.push(...diffControl(a.control, b.control));
    if (problems.length) differences.push({ text: a.text, detail: problems.join('; ') });
  }
  return differences;
}
