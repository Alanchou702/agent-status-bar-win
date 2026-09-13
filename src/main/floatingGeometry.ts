export interface Rect { x: number; y: number; width: number; height: number }
export function expandedBounds(compact: Rect, workArea: Rect): Rect {
  const width = Math.min(410, workArea.width);
  const height = Math.min(610, workArea.height);
  return { width, height,
    x: Math.max(workArea.x, Math.min(compact.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(compact.y, workArea.y + workArea.height - height)) };
}

