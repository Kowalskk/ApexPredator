import fs from "fs";
import path from "path";

// Listas estáticas de CEX/Bridge/Mixer/Swap reusadas del proyecto fresh.
// Lookup local sin coste de API. Se carga una vez al arranque.

interface FunderEntry {
  address: string;
  protocol: string;
  label: string;
  chain: string;
  role: "cex" | "bridge" | "mixer" | "swap";
  source: string;
  last_verified: string;
}

export interface KnownFunder {
  type: "CEX" | "BRIDGE" | "MIXER" | "SWAP_SERVICE";
  label: string;
  protocol: string;
}

const map = new Map<string, KnownFunder>();

const CHAIN_FILE_NAME: Record<string, string> = {
  eth: "ethereum",
  bsc: "bsc",
};

const ROLE_TO_TYPE: Record<string, KnownFunder["type"]> = {
  cex: "CEX",
  bridge: "BRIDGE",
  mixer: "MIXER",
  swap: "SWAP_SERVICE",
};

function loadFile(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, "utf-8");
    const entries: FunderEntry[] = JSON.parse(raw);
    for (const e of entries) {
      const type = ROLE_TO_TYPE[e.role];
      if (!type) continue;
      map.set(e.address.toLowerCase(), {
        type,
        label: e.label,
        protocol: e.protocol,
      });
    }
  } catch (err) {
    console.warn(`[funder_lists] failed to load ${filePath}:`, (err as Error).message);
  }
}

// Resuelve directorio de datos: prioriza el del proyecto vecino "fresh" para
// compartir base de labels entre proyectos. Fallback a Sol/data/funders local.
function findDataDir(): string {
  const candidates = [
    // Hermanos en c:\Users\torra\Documents\fresh\data\funders
    path.resolve(__dirname, "..", "..", "..", "..", "fresh", "data", "funders"),
    path.resolve(__dirname, "..", "..", "..", "..", "..", "fresh", "data", "funders"),
    // Fallback local
    path.resolve(__dirname, "..", "..", "data", "funders"),
    path.resolve(__dirname, "..", "..", "..", "data", "funders"),
    path.resolve(process.cwd(), "data", "funders"),
    path.resolve(process.cwd(), "..", "fresh", "data", "funders"),
  ];
  return candidates.find((d) => fs.existsSync(d)) || candidates[0];
}

const DATA_DIR = findDataDir();
for (const chain of ["ethereum", "bsc"]) {
  for (const role of ["cex", "bridge", "mixer", "swap"]) {
    loadFile(path.join(DATA_DIR, `${role}.${chain}.json`));
  }
}

// Adicional: carga learned_labels.json (harvest de Arkham acumulado)
function loadLearned(filePath: string): number {
  let n = 0;
  try {
    if (!fs.existsSync(filePath)) return 0;
    const raw = fs.readFileSync(filePath, "utf-8");
    const entries: Array<{
      address: string;
      chain: string;
      funder_type?: string | null;
      entity_name?: string | null;
      label_name?: string | null;
    }> = JSON.parse(raw);
    for (const e of entries) {
      const ft = (e.funder_type || "").toUpperCase();
      const type =
        ft === "CEX" ? "CEX" :
        ft === "BRIDGE" ? "BRIDGE" :
        ft === "MIXER" ? "MIXER" :
        ft === "SWAP_SERVICE" ? "SWAP_SERVICE" :
        null;
      if (!type) continue;
      const label = e.entity_name && e.label_name
        ? `${e.entity_name} · ${e.label_name}`
        : (e.entity_name || e.label_name || "Unknown");
      map.set(e.address.toLowerCase(), { type, label, protocol: (e.entity_name || "").toLowerCase() });
      n++;
    }
  } catch (err) {
    console.warn(`[funder_lists] learned_labels load failed:`, (err as Error).message);
  }
  return n;
}

const learnedCount = loadLearned(path.join(DATA_DIR, "learned_labels.json"));
console.log(`[funder_lists] loaded ${map.size} known funders from ${DATA_DIR} (${learnedCount} learned)`);

export function lookupKnownFunder(address: string): KnownFunder | null {
  return map.get(address.toLowerCase()) || null;
}

export function chainFileName(chain: string): string | undefined {
  return CHAIN_FILE_NAME[chain];
}

// ─── Persist new learned labels to disk (append) ─────────────────────────────
// Cuando Arkham descubre una wallet nueva, la persistimos a learned_labels.json
// para que sobreviva cuando expire la key. Append-only, dedup en memoria.

interface LearnedEntry {
  address: string;
  chain: string;
  funder_type: string | null;
  entity_name: string | null;
  label_name: string | null;
  added_at: string;
}

const learnedFile = path.join(DATA_DIR, "learned_labels.json");
const persistedSet = new Set<string>();

// Rellena persistedSet con lo ya guardado
try {
  if (fs.existsSync(learnedFile)) {
    const existing: LearnedEntry[] = JSON.parse(fs.readFileSync(learnedFile, "utf-8"));
    for (const e of existing) persistedSet.add(`${e.chain}:${e.address.toLowerCase()}`);
  }
} catch {/* skip */}

export function persistLearnedLabel(entry: {
  address: string;
  chain: string;
  funderType: string | null;
  entityName: string | null;
  labelName: string | null;
}): void {
  if (!entry.funderType && !entry.entityName && !entry.labelName) return;
  const key = `${entry.chain}:${entry.address.toLowerCase()}`;
  if (persistedSet.has(key)) return;
  persistedSet.add(key);
  try {
    let list: LearnedEntry[] = [];
    if (fs.existsSync(learnedFile)) {
      try { list = JSON.parse(fs.readFileSync(learnedFile, "utf-8")); } catch { list = []; }
    }
    list.push({
      address: entry.address.toLowerCase(),
      chain: entry.chain,
      funder_type: entry.funderType,
      entity_name: entry.entityName,
      label_name: entry.labelName,
      added_at: new Date().toISOString(),
    });
    fs.writeFileSync(learnedFile, JSON.stringify(list, null, 2), "utf-8");
    // Mete también en el map en caliente
    const ft = (entry.funderType || "").toUpperCase();
    const type = ft === "CEX" ? "CEX" : ft === "BRIDGE" ? "BRIDGE" : ft === "MIXER" ? "MIXER" : ft === "SWAP_SERVICE" ? "SWAP_SERVICE" : null;
    if (type) {
      const label = entry.entityName && entry.labelName ? `${entry.entityName} · ${entry.labelName}` : (entry.entityName || entry.labelName || "Unknown");
      map.set(entry.address.toLowerCase(), { type, label, protocol: (entry.entityName || "").toLowerCase() });
    }
  } catch (err) {
    console.warn(`[funder_lists] persist failed:`, (err as Error).message);
  }
}

export function getDataDir(): string {
  return DATA_DIR;
}
