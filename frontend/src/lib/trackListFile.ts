/**
 * trackListFile.ts — extraction d'une liste de titres depuis un fichier collé
 * ou uploadé (Excel .xlsx/.xls, CSV, TXT, PDF).
 *
 * Chaque fichier est transformé en un tableau de lignes « Artiste - Titre »
 * (au mieux) que l'onglet « Coller une liste » ré-affiche pour révision avant
 * la recherche. Les libs lourdes (xlsx, pdfjs) sont chargées en import()
 * dynamique → code-split, chargées seulement à l'usage.
 */

/** Transforme des lignes de cellules en lignes texte « a - b - c » (cellules
 *  vides ignorées, lignes vides supprimées). */
function rowsToLines(rows: unknown[][]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const cells = row
      .map((c) => (c === null || c === undefined ? '' : String(c).trim()))
      .filter((c) => c.length > 0);
    if (cells.length === 0) continue;
    out.push(cells.join(' - '));
  }
  return out;
}

/** CSV / TSV natif — pas de dépendance. Détecte tab ; , comme séparateur. */
function parseDelimited(text: string): string[] {
  const rows = text.split(/\r?\n/).map((line) => {
    if (line.includes('\t')) return line.split('\t');
    if (line.includes(';')) return line.split(';');
    if (line.includes(',')) return line.split(',');
    return [line];
  });
  return rowsToLines(rows);
}

async function parseXlsx(file: File): Promise<string[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const sheet = wb.Sheets[first];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as unknown[][];
  return rowsToLines(rows);
}

async function parsePdf(file: File): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  // Worker bundlé par Vite (?url renvoie l'URL de l'asset).
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: buf });
  const doc = await loadingTask.promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Regroupe les fragments par ligne (même y arrondi), triés par x.
    const byLine = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items) {
      // item est TextItem : { str, transform: [a,b,c,d,x,y] }
      const it = item as { str?: string; transform?: number[] };
      if (!it.str || !it.transform) continue;
      const x = it.transform[4] ?? 0;
      const y = Math.round(it.transform[5] ?? 0);
      const arr = byLine.get(y) ?? [];
      arr.push({ x, s: it.str });
      byLine.set(y, arr);
    }
    const ys = [...byLine.keys()].sort((a, b) => b - a); // haut → bas
    for (const y of ys) {
      const frags = byLine.get(y)!;
      const line = frags
        .sort((a, b) => a.x - b.x)
        .map((f) => f.s)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (line) lines.push(line);
    }
  }
  await loadingTask.destroy();
  return lines;
}

/** Point d'entrée : renvoie les lignes extraites du fichier selon son type. */
export async function parseTrackListFile(file: File): Promise<string[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return parsePdf(file);
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseXlsx(file);
  if (name.endsWith('.csv') || name.endsWith('.tsv')) return parseDelimited(await file.text());
  // .txt et fallback : une ligne = un titre.
  return (await file.text())
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
