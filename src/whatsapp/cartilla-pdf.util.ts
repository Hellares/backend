import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';

/**
 * PDF con las CARTILLAS del bingo (una por página): grilla 5×5
 * B-I-N-G-O con el número de cartilla, el nombre del jugador y la
 * empresa. Devuelve base64 — Evolution lo envía como documento por
 * WhatsApp (el cliente lo ve, lo marca o lo imprime).
 */
export async function generarCartillasPdf(args: {
  sorteoTitulo: string;
  empresaNombre: string;
  cartillas: { numero: number | null; nombre: string; grid: number[][] }[];
}): Promise<string> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const azul = rgb(0, 0.29, 0.58);
  const gris = rgb(0.45, 0.45, 0.45);
  const negro = rgb(0.1, 0.1, 0.1);

  const W = 420;
  const H = 500;
  const centrar = (
    page: any,
    texto: string,
    y: number,
    size: number,
    font: PDFFont,
    color: any,
  ) => {
    const w = font.widthOfTextAtSize(texto, size);
    page.drawText(texto, { x: (W - w) / 2, y, size, font, color });
  };

  for (const c of args.cartillas) {
    const page = doc.addPage([W, H]);
    centrar(page, sane(args.sorteoTitulo.toUpperCase()), 462, 14, bold, azul);
    centrar(page, `CARTILLA #${c.numero ?? '—'}`, 430, 24, bold, negro);
    centrar(page, sane(c.nombre.toUpperCase()), 408, 11, regular, gris);

    // Grilla 5×5 (celdas de 64×56) centrada.
    const cell = 64;
    const alto = 56;
    const gridW = cell * 5;
    const x0 = (W - gridW) / 2;
    const yHeader = 378;
    const letras = ['B', 'I', 'N', 'G', 'O'];
    for (let col = 0; col < 5; col++) {
      const letra = letras[col];
      const w = bold.widthOfTextAtSize(letra, 18);
      page.drawText(letra, {
        x: x0 + col * cell + (cell - w) / 2,
        y: yHeader,
        size: 18,
        font: bold,
        color: azul,
      });
    }
    const yTop = 370; // borde superior de la grilla
    for (let r = 0; r < 5; r++) {
      for (let col = 0; col < 5; col++) {
        const x = x0 + col * cell;
        const y = yTop - (r + 1) * alto;
        page.drawRectangle({
          x,
          y,
          width: cell,
          height: alto,
          borderColor: gris,
          borderWidth: 1,
        });
        const n = c.grid[r]?.[col] ?? 0;
        if (n === 0) {
          const w = bold.widthOfTextAtSize('LIBRE', 10);
          page.drawText('LIBRE', {
            x: x + (cell - w) / 2,
            y: y + alto / 2 - 4,
            size: 10,
            font: bold,
            color: azul,
          });
        } else {
          const texto = n.toString();
          const w = bold.widthOfTextAtSize(texto, 20);
          page.drawText(texto, {
            x: x + (cell - w) / 2,
            y: y + alto / 2 - 7,
            size: 20,
            font: bold,
            color: negro,
          });
        }
      }
    }
    centrar(
      page,
      sane(args.empresaNombre),
      46,
      9,
      regular,
      gris,
    );
    centrar(page, '¡Suerte! Marca tus numeros con cada bolilla cantada', 30, 8, regular, gris);
  }

  const bytes = await doc.save();
  return Buffer.from(bytes).toString('base64');
}

/** Helvetica estándar no soporta todos los caracteres — sanear. */
function sane(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}
