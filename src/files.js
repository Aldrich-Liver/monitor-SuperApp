import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  const text = readFileSync(path, "utf8").trim();
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    console.warn(`Aviso: ${path} no es JSON válido; se ignora.`);
    return fallback;
  }
}

export function writeJson(path, data, pretty = true) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, pretty ? 2 : 0) + "\n");
}
