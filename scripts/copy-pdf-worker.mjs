// Copies the pdf.js worker into public/ so GlobalWorkerOptions.workerSrc can
// point at /pdf.worker.min.mjs. The file is copied (not vendored) so it can
// never drift from the pdfjs-dist version pinned in package.json.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs");
const dest = resolve(root, "public/pdf.worker.min.mjs");

mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
console.log(`Copied ${src} -> ${dest}`);
