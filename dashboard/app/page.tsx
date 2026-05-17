"use client";

import { useState } from "react";
import { Plus, Trash2, Search, Copy, ExternalLink, Loader2, CheckCheck } from "lucide-react";

// ─── Types (match API response from Sol/src/api.ts) ───────────────────────────

interface PerToken {
  symbol: string;
  chain: string;
  nativeSym: string;
  status: "holding" | "partial" | "sold_all" | "never_bought";
  totalBought: number;
  nativeSpent: number;
  nativeSpentUsd: number;
  marketCapAtEntryUsd: number;
  pctSupplyBought: number;
  currentBalance: number;
  holderPct: number;
  holderUsd: number;
}

interface Wallet {
  address: string;
  nativeBalance: number;
  nativeSym: string;
  nativeBalanceUsd: number;
  funding: { source: string; label: string | null };
  perToken: PerToken[];
}

interface KolResponse {
  wallets: Wallet[];
  meta: {
    tokens: number;
    symbols: string[];
    chains: string[];
    rangeLabel: string;
    intersection: number;
    kept: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_EMOJI: Record<string, string> = {
  holding: "💎",
  partial: "🔸",
  sold_all: "❌",
  never_bought: "·",
};

const EXPLORER: Record<string, string> = {
  eth: "https://etherscan.io/address/",
  bsc: "https://bscscan.com/address/",
  base: "https://basescan.org/address/",
  arbitrum: "https://arbiscan.io/address/",
};

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtNum(n: number): string {
  if (!isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-zinc-500 hover:text-zinc-200 transition-colors"
    >
      {copied ? <CheckCheck size={13} /> : <Copy size={13} />}
    </button>
  );
}

// ─── Wallet Card ──────────────────────────────────────────────────────────────

function WalletCard({ wallet, mainChain }: { wallet: Wallet; mainChain: string }) {
  const explorerUrl = (EXPLORER[mainChain] || EXPLORER.eth) + wallet.address;
  const fundingLabel = wallet.funding.label || wallet.funding.source;

  return (
    <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900 space-y-3">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-emerald-400 text-sm font-semibold">
          {shortAddr(wallet.address)}
        </span>
        <CopyButton text={wallet.address} />
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-zinc-500 hover:text-zinc-200 transition-colors">
          <ExternalLink size={13} />
        </a>
        <span className="ml-auto text-xs text-zinc-400">
          💰 {fmtNum(wallet.nativeBalance)} {wallet.nativeSym}
          {wallet.nativeBalanceUsd > 0 && <span className="text-zinc-600 ml-1">({fmtUsd(wallet.nativeBalanceUsd)})</span>}
        </span>
        {fundingLabel && fundingLabel !== "UNKNOWN" && (
          <span className="text-xs text-zinc-500 italic">🔗 {fundingLabel}</span>
        )}
      </div>

      {/* Per-token table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-600 border-b border-zinc-800">
              <th className="text-left pb-1 pr-3 font-normal">Token</th>
              <th className="text-right pb-1 pr-3 font-normal">Compró</th>
              <th className="text-right pb-1 pr-3 font-normal">Gastó</th>
              <th className="text-right pb-1 pr-3 font-normal">MC@entry</th>
              <th className="text-right pb-1 font-normal">Estado</th>
            </tr>
          </thead>
          <tbody>
            {wallet.perToken.map((t, i) => (
              <tr key={i} className="border-b border-zinc-800/40 last:border-0">
                <td className="py-1 pr-3 text-zinc-300 font-semibold">
                  {t.symbol}
                  {t.chain !== mainChain && (
                    <span className="ml-1 text-zinc-600">[{t.chain.toUpperCase()}]</span>
                  )}
                </td>
                <td className="py-1 pr-3 text-right text-zinc-400">
                  {t.status === "never_bought" ? <span className="text-zinc-600">—</span> : (
                    <>
                      {fmtNum(t.totalBought)}
                      {t.pctSupplyBought > 0 && (
                        <span className="text-zinc-600 ml-1">({t.pctSupplyBought.toFixed(3)}%)</span>
                      )}
                    </>
                  )}
                </td>
                <td className="py-1 pr-3 text-right text-zinc-400">
                  {t.status === "never_bought" ? <span className="text-zinc-600">—</span> : (
                    t.nativeSpentUsd > 0 ? fmtUsd(t.nativeSpentUsd) : `${fmtNum(t.nativeSpent)} ${t.nativeSym}`
                  )}
                </td>
                <td className="py-1 pr-3 text-right text-zinc-400">
                  {t.marketCapAtEntryUsd > 0 ? fmtUsd(t.marketCapAtEntryUsd) : <span className="text-zinc-600">n/d</span>}
                </td>
                <td className="py-1 text-right text-base">
                  {STATUS_EMOJI[t.status] ?? "·"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function KolFinderPage() {
  const [tokens, setTokens] = useState<string[]>(["", ""]);
  const [fromDate, setFromDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<KolResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addToken = () => { if (tokens.length < 5) setTokens([...tokens, ""]); };
  const removeToken = (i: number) => { if (tokens.length > 2) setTokens(tokens.filter((_, idx) => idx !== i)); };
  const updateToken = (i: number, val: string) => { const next = [...tokens]; next[i] = val; setTokens(next); };

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const validTokens = tokens.map(t => t.trim()).filter(t => /^0x[a-fA-F0-9]{40}$/i.test(t));
    if (validTokens.length < 2) { setError("Necesitas al menos 2 direcciones EVM válidas (0x...)"); return; }

    setLoading(true); setError(null); setData(null);

    try {
      const body: { tokens: string[]; fromDate?: string } = { tokens: validTokens };
      if (fromDate) body.fromDate = fromDate;

      const res = await fetch("/api/kol", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      setData(json as KolResponse);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  const mainChain = data?.meta.chains?.[0] ?? "eth";

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-emerald-400">⚡ Overlap Wallets</h1>
          <p className="text-sm text-zinc-500 mt-1">Wallets que compraron en múltiples tokens EVM</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs text-zinc-400 uppercase tracking-wider">Token Addresses (2–5)</label>
            {tokens.map((tok, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  value={tok}
                  onChange={e => updateToken(i, e.target.value)}
                  placeholder={`0x… token ${i + 1}`}
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
                {tokens.length > 2 && (
                  <button type="button" onClick={() => removeToken(i)} className="p-2 text-zinc-600 hover:text-red-400 transition-colors">
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            ))}
            {tokens.length < 5 && (
              <button type="button" onClick={addToken} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-emerald-400 transition-colors">
                <Plus size={13} /> Añadir token
              </button>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-xs text-zinc-400 uppercase tracking-wider">Desde (opcional)</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500 transition-colors [color-scheme:dark]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded transition-colors"
          >
            {loading ? <><Loader2 size={15} className="animate-spin" /> Escaneando…</> : <><Search size={15} /> Buscar Overlap</>}
          </button>
        </form>

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-16 text-zinc-500">
            <Loader2 size={32} className="animate-spin text-emerald-500" />
            <p className="text-sm">Analizando datos on-chain… puede tardar 1–3 minutos</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="border border-red-800 bg-red-950/40 rounded px-4 py-3 text-sm text-red-400">{error}</div>
        )}

        {/* Results */}
        {data && !loading && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-400">
                <span className="text-emerald-400 font-semibold">{data.wallets.length}</span> wallets encontradas
                {data.meta && (
                  <span className="text-zinc-600 ml-2">
                    · {data.meta.intersection} candidatas antes de filtro · {data.meta.rangeLabel} · {data.meta.chains.join("+")}
                  </span>
                )}
              </p>
            </div>
            {data.wallets.length === 0 ? (
              <p className="text-sm text-zinc-600 py-10 text-center">No se encontraron wallets comunes.</p>
            ) : (
              data.wallets.map((w, i) => <WalletCard key={i} wallet={w} mainChain={mainChain} />)
            )}
          </div>
        )}
      </div>
    </main>
  );
}
