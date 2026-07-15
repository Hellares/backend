import * as sharp from 'sharp';

/**
 * Cartilla de BINGO como IMAGEN (PNG, base64): se ve INLINE en el chat
 * de WhatsApp — el cliente la mira al instante, hace zoom y la marca
 * durante el live. Para compras grandes (>5) se usa el PDF único.
 * Render: SVG dibujado a mano → sharp (requiere fuentes en el
 * container: fontconfig + ttf-dejavu en el Dockerfile).
 */
export async function generarCartillaPng(args: {
  sorteoTitulo: string;
  empresaNombre: string;
  numero: number | null;
  nombre: string;
  grid: number[][];
}): Promise<string> {
  const W = 640;
  const H = 800;
  const azul = '#004A94';
  const gris = '#6b7280';
  const cell = 112;
  const alto = 96;
  const x0 = (W - cell * 5) / 2;
  const yGrid = 250;

  const letras = ['B', 'I', 'N', 'G', 'O'];
  const partes: string[] = [];

  // Cabecera
  partes.push(
    `<text x="${W / 2}" y="70" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="26" font-weight="bold" fill="${azul}">${esc(args.sorteoTitulo.toUpperCase())}</text>`,
    `<text x="${W / 2}" y="130" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="48" font-weight="bold" fill="#111">CARTILLA #${args.numero ?? '—'}</text>`,
    `<text x="${W / 2}" y="170" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="22" fill="${gris}">${esc(args.nombre.toUpperCase())}</text>`,
  );
  // Letras B I N G O
  for (let c = 0; c < 5; c++) {
    partes.push(
      `<text x="${x0 + c * cell + cell / 2}" y="${yGrid - 18}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="34" font-weight="bold" fill="${azul}">${letras[c]}</text>`,
    );
  }
  // Grilla
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const x = x0 + c * cell;
      const y = yGrid + r * alto;
      partes.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${alto}" fill="white" stroke="#9ca3af" stroke-width="2" rx="6"/>`,
      );
      const n = args.grid[r]?.[c] ?? 0;
      if (n === 0) {
        partes.push(
          `<text x="${x + cell / 2}" y="${y + alto / 2 + 8}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="22" font-weight="bold" fill="${azul}">LIBRE</text>`,
        );
      } else {
        partes.push(
          `<text x="${x + cell / 2}" y="${y + alto / 2 + 13}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="38" font-weight="bold" fill="#111">${n}</text>`,
        );
      }
    }
  }
  // Pie
  partes.push(
    `<text x="${W / 2}" y="${H - 40}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="18" fill="${gris}">${esc(args.empresaNombre)}</text>`,
    `<text x="${W / 2}" y="${H - 16}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="15" fill="${gris}">Marca tus números con cada bolilla cantada — ¡suerte!</text>`,
  );

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="#f8fafc"/>` +
    partes.join('') +
    '</svg>';

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return png.toString('base64');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
