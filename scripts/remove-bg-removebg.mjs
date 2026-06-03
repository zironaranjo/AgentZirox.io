/**
 * Quita el fondo con remove.bg (https://www.remove.bg/api)
 *
 * Uso:
 *   REMOVE_BG_API_KEY=tu_key node scripts/remove-bg-removebg.mjs
 *   REMOVE_BG_API_KEY=tu_key node scripts/remove-bg-removebg.mjs public/otra.png
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const apiKey = process.env.REMOVE_BG_API_KEY?.trim();
if (!apiKey) {
  console.error("Falta REMOVE_BG_API_KEY en el entorno o en .env");
  process.exit(1);
}

const inputArg = process.argv[2];
const src = path.resolve(root, inputArg ?? "public/zirox.png");
const dst = src.replace(/\.(png|jpe?g|webp)$/i, "-nobg.png");

if (!fs.existsSync(src)) {
  console.error(`No existe: ${src}`);
  process.exit(1);
}

const form = new FormData();
form.append("image_file", new Blob([fs.readFileSync(src)]), path.basename(src));
form.append("size", "auto");
form.append("format", "png");
form.append("type", "auto");

console.log(`remove.bg → ${path.basename(src)} ...`);

const res = await fetch("https://api.remove.bg/v1.0/removebg", {
  method: "POST",
  headers: { "X-Api-Key": apiKey },
  body: form,
});

if (!res.ok) {
  const errText = await res.text();
  console.error(`Error ${res.status}:`, errText.slice(0, 500));
  process.exit(1);
}

const buffer = Buffer.from(await res.arrayBuffer());
fs.writeFileSync(dst, buffer);
console.log(`OK: ${dst} (${(buffer.length / 1024).toFixed(1)} KB)`);
