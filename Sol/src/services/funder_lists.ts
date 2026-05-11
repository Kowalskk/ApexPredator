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

// Carga inicial — busca data/funders en varias rutas relativas (src y dist)
const CANDIDATE_DIRS = [
  path.resolve(__dirname, "..", "..", "data", "funders"),           // src/services → root
  path.resolve(__dirname, "..", "..", "..", "data", "funders"),     // dist/services → root
  path.resolve(process.cwd(), "data", "funders"),                    // cwd-based
];
let DATA_DIR = CANDIDATE_DIRS.find((d) => fs.existsSync(d)) || CANDIDATE_DIRS[0];
for (const chain of ["ethereum", "bsc"]) {
  for (const role of ["cex", "bridge", "mixer", "swap"]) {
    loadFile(path.join(DATA_DIR, `${role}.${chain}.json`));
  }
}
console.log(`[funder_lists] loaded ${map.size} known funders from ${DATA_DIR}`);

export function lookupKnownFunder(address: string): KnownFunder | null {
  return map.get(address.toLowerCase()) || null;
}

export function chainFileName(chain: string): string | undefined {
  return CHAIN_FILE_NAME[chain];
}
