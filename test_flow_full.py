import paramiko, sys, io, textwrap

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('95.179.243.31', username='root', password='4mZ=hCCo49xD3#DK')

script = textwrap.dedent('''
import 'dotenv/config';
const KEY = process.env.MORALIS_API_KEY;
const WALLET = "0x73d8bd54f7cf5fab43fe4ef40a62d390644946db";
const TOKEN = "0x0A43fC31a73013089DF59194872Ecae4cAe14444";
const BASE = "https://deep-index.moralis.io/api/v2.2";
const CHAIN = "bsc";

let cursor = null;
let pages = 0;
let total = 0;
let firstTs = null;
let lastTs = null;
let inCount = 0, outCount = 0;
let inAmount = 0, outAmount = 0;
const counterparties = new Map();
const t0 = Date.now();
const MAX_PAGES = 50;  // safety cap

while (pages < MAX_PAGES) {
  const params = new URLSearchParams({ chain: CHAIN, limit: "100", order: "DESC" });
  params.append("contract_addresses[0]", TOKEN);
  if (cursor) params.set("cursor", cursor);
  const url = `${BASE}/${WALLET}/erc20/transfers?${params}`;
  const r = await fetch(url, { headers: { "X-API-Key": KEY } });
  if (!r.ok) { console.log("ERR", r.status, await r.text()); break; }
  const j = await r.json();
  const arr = j.result || [];
  pages++;
  total += arr.length;
  for (const t of arr) {
    const ts = t.block_timestamp || t.blockTimestamp;
    if (!firstTs || ts < firstTs) firstTs = ts;
    if (!lastTs || ts > lastTs) lastTs = ts;
    const from = (t.from_address || t.fromAddress || "").toLowerCase();
    const to = (t.to_address || t.toAddress || "").toLowerCase();
    const decimals = parseInt(t.token_decimals || t.tokenDecimals || "18");
    const raw = BigInt(t.value || "0");
    const amt = Number(raw) / 10 ** decimals;
    if (from === WALLET.toLowerCase()) {
      outCount++; outAmount += amt;
      counterparties.set(to, (counterparties.get(to)||0) + amt);
    } else if (to === WALLET.toLowerCase()) {
      inCount++; inAmount += amt;
      counterparties.set(from, (counterparties.get(from)||0) + amt);
    }
  }
  cursor = j.cursor || null;
  if (!cursor || arr.length === 0) break;
}

const dt = ((Date.now()-t0)/1000).toFixed(1);
console.log("=== FULL HISTORY SCAN ===");
console.log("pages fetched:", pages, "(cap was", MAX_PAGES + ")");
console.log("total transfers:", total);
console.log("more pages remaining:", !!cursor);
console.log("time:", dt, "s");
console.log("\\nIN:", inCount, "transfers,", inAmount.toFixed(2), "tokens");
console.log("OUT:", outCount, "transfers,", outAmount.toFixed(2), "tokens");
console.log("NET:", (inAmount - outAmount).toFixed(2), "tokens");
console.log("\\noldest tx:", firstTs);
console.log("newest tx:", lastTs);
console.log("\\nunique counterparties:", counterparties.size);
const top = Array.from(counterparties.entries()).sort((a,b)=>b[1]-a[1]).slice(0,10);
console.log("top 10 by volume:");
for (const [a, v] of top) console.log("  ", a, v.toFixed(2));

console.log("\\n=== COST ESTIMATE ===");
console.log("Pages used:", pages, "× ~5 CU = ~" + (pages*5) + " CU");
console.log("% of 40K daily quota:", ((pages*5)/40000*100).toFixed(2) + "%");
if (cursor) console.log("⚠️  History incomplete — bump MAX_PAGES to scan further");
''')

sftp = ssh.open_sftp()
with sftp.open('/opt/apexpredator/Sol/flow_full.mjs', 'w') as f:
    f.write(script)
sftp.close()

stdin, stdout, stderr = ssh.exec_command('cd /opt/apexpredator/Sol && node flow_full.mjs')
print(stdout.read().decode('utf-8', errors='replace'))
err = stderr.read().decode('utf-8', errors='replace')
if err: print("STDERR:", err)
ssh.close()
