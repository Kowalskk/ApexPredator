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

async function detectChain() {
  const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${TOKEN}`);
  const j = await r.json();
  const pairs = (j.pairs || []).sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0));
  return pairs[0] ? { chainId: pairs[0].chainId, symbol: pairs[0].baseToken.symbol, liq: pairs[0].liquidity?.usd } : null;
}

const MAP = { ethereum: "eth", bsc: "bsc", base: "base", arbitrum: "arbitrum", polygon: "polygon" };

async function testFiltered(chain) {
  // Test 1: filtro server-side por contract_addresses
  const url1 = `${BASE}/${WALLET}/erc20/transfers?chain=${chain}&limit=100&order=DESC&contract_addresses%5B0%5D=${TOKEN}`;
  const r1 = await fetch(url1, { headers: { "X-API-Key": KEY } });
  const j1 = await r1.json();
  const arr1 = j1.result || [];
  const matched1 = arr1.filter(t => (t.address||"").toLowerCase() === TOKEN.toLowerCase()).length;
  console.log("=== TEST 1: contract_addresses filter ===");
  console.log("status:", r1.status);
  console.log("page1 size:", arr1.length);
  console.log("matched token:", matched1, "/", arr1.length);
  console.log("cursor present:", !!j1.cursor);
  if (arr1.length > 0) {
    console.log("oldest in page:", arr1[arr1.length-1].blockTimestamp);
    console.log("newest in page:", arr1[0].blockTimestamp);
  }

  // Test 2: sin filtro, ver ratio
  const url2 = `${BASE}/${WALLET}/erc20/transfers?chain=${chain}&limit=100&order=DESC`;
  const r2 = await fetch(url2, { headers: { "X-API-Key": KEY } });
  const j2 = await r2.json();
  const arr2 = j2.result || [];
  const matched2 = arr2.filter(t => (t.address||"").toLowerCase() === TOKEN.toLowerCase()).length;
  console.log("\\n=== TEST 2: NO filter (ratio check) ===");
  console.log("page1 size:", arr2.length);
  console.log("matched token:", matched2, "/", arr2.length, `(${(matched2/arr2.length*100).toFixed(1)}%)`);
  if (arr2.length > 0) {
    console.log("oldest in page:", arr2[arr2.length-1].blockTimestamp);
    console.log("newest in page:", arr2[0].blockTimestamp);
  }

  // Test 3: token-side endpoint con wallet filter (from_date opcional)
  const url3 = `${BASE}/erc20/${TOKEN}/transfers?chain=${chain}&limit=100&order=DESC&wallet_addresses%5B0%5D=${WALLET}`;
  const r3 = await fetch(url3, { headers: { "X-API-Key": KEY } });
  const j3 = await r3.json();
  const arr3 = j3.result || [];
  const matched3 = arr3.filter(t => {
    const f = (t.from_address || t.fromAddress || "").toLowerCase();
    const to = (t.to_address || t.toAddress || "").toLowerCase();
    return f === WALLET.toLowerCase() || to === WALLET.toLowerCase();
  }).length;
  console.log("\\n=== TEST 3: token endpoint + wallet_addresses filter ===");
  console.log("status:", r3.status);
  console.log("page1 size:", arr3.length);
  console.log("matched wallet:", matched3, "/", arr3.length);
  console.log("cursor present:", !!j3.cursor);
  if (arr3.length > 0) {
    console.log("oldest in page:", arr3[arr3.length-1].block_timestamp || arr3[arr3.length-1].blockTimestamp);
    console.log("newest in page:", arr3[0].block_timestamp || arr3[0].blockTimestamp);
  }
}

(async () => {
  const det = await detectChain();
  console.log("DexScreener:", JSON.stringify(det));
  const chain = MAP[det.chainId] || "eth";
  console.log("Using chain:", chain, "\\n");
  await testFiltered(chain);
})().catch(e => console.error("ERR", e.message));
''')

sftp = ssh.open_sftp()
with sftp.open('/tmp/flow_test.mjs', 'w') as f:
    f.write(script)
sftp.close()

sftp = ssh.open_sftp()
with sftp.open('/opt/apexpredator/Sol/flow_test.mjs', 'w') as f:
    f.write(script)
sftp.close()
stdin, stdout, stderr = ssh.exec_command('cd /opt/apexpredator/Sol && node flow_test.mjs')
print(stdout.read().decode('utf-8', errors='replace'))
err = stderr.read().decode('utf-8', errors='replace')
if err: print("STDERR:", err)
ssh.close()
