// Hand-printed riso chart hand (Kiez-Daten "Mischung"). Deterministic: same
// seed → same wobble, so SSR and client render identical markup.
const kzRnd = (i: number, seed: number): number => {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function kzWobLine(x1: number, y1: number, x2: number, y2: number, seed = 1, amp = 1.4, segs = 7): string {
  const pts: string[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const jx = (kzRnd(i, seed) - 0.5) * amp;
    const jy = (kzRnd(i, seed + 5) - 0.5) * amp;
    pts.push(
      `${(x1 + (x2 - x1) * t + (i === 0 || i === segs ? 0 : jx)).toFixed(1)},${(y1 + (y2 - y1) * t + (i === 0 || i === segs ? 0 : jy)).toFixed(1)}`
    );
  }
  return pts.join(' ');
}

export function kzWobRect(x: number, y: number, w: number, h: number, seed = 1, amp = 1.3): string {
  const j = (i: number, s: number) => (kzRnd(i, seed + s) - 0.5) * amp;
  return `M${x},${y + j(0, 1)} L${x + w + j(1, 2)},${y + j(2, 3)} L${x + w + j(3, 4)},${y + h + j(4, 5)} L${x + j(5, 6)},${y + h + j(6, 7)} Z`;
}
