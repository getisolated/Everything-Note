/** Hue 0-360, saturation and value 0-1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** `#rrggbb` in lower case from `#rgb`, `rgb`, `#rrggbb` or `rrggbb`; `null` for anything else. */
export function normalizeHex(input: string): string | null {
  const match = /^#?(?<hex>[0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  const hex = match?.groups?.['hex'];

  if (!hex) {
    return null;
  }

  const full = hex.length === 3 ? [...hex].map(char => `${char}${char}`).join('') : hex;
  return `#${full.toLowerCase()}`;
}

export function hexToHsv(hex: string): Hsv {
  const normalized = normalizeHex(hex) ?? '#000000';
  const [r, g, b] = [1, 3, 5].map(index => parseInt(normalized.slice(index, index + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;

  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
  }

  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const channel = (n: number): string => {
    const k = (n + h / 60) % 6;
    const value = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };

  return `#${channel(5)}${channel(3)}${channel(1)}`;
}
