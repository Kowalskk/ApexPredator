# Listas de funders — schema

Cada archivo es un JSON con array de objetos. Schema:

```ts
interface FunderEntry {
  address: string;          // checksum o lower-case 0x… — normalizar al cargar
  protocol: string;         // 'binance' | 'tornado-cash' | 'stargate' | …
  label: string;            // human-readable: 'Binance Hot 14', 'Tornado 1 ETH Pool'
  chain: 'ethereum' | 'bsc';
  role: 'cex' | 'bridge' | 'mixer' | 'swap';
  source: string;           // de dónde viene la entry (URL, repo, manual)
  last_verified: string;    // ISO date
}
```

## Archivos

- `cex.ethereum.json` — hot wallets de exchanges centralizados en mainnet.
- `cex.bsc.json` — hot wallets en BSC (Binance es nativo aquí, mayor cobertura esperada).
- `bridge.ethereum.json` — Stargate, Across, Hop, Orbiter, LayerZero + EntryPoints ERC-4337.
- `bridge.bsc.json`
- `mixer.ethereum.json` — pools de Tornado Cash + Railgun.
- `mixer.bsc.json`
- `swap.ethereum.json` — instant swap services anónimos (ChangeNOW, FixedFloat, eXch, SideShift, SimpleSwap).
- `swap.bsc.json`

## Política

- **Seed inicial**: direcciones obvias y conocidas hoy (limitado).
- **Expansión**: tras research M0.5 (Etherscan labels, Arkham, repos comunitarios, Dune queries).
- **Validación**: `npm run validate-funders` verifica checksum y on-chain code (contrato vs EOA).
- **Actualización**: revisar `last_verified` mensualmente; flagear si > 90 días.
