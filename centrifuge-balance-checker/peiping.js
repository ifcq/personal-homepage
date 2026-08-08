const EPS = 1e-6;
let table = null, mode = 'auto', slots = [], n = 24, k = 6;
const $ = id => document.getElementById(id);

fetch('centrifuge_balance_schemes.json').then(r => r.json()).then(x => { table = x; run(); }).catch(() => { table = null; run(); });

function factors(x) { const out = []; for (let d = 2; d * d <= x; d++) { if (x % d === 0) { out.push(d); while (x % d === 0) x /= d; } } if (x > 1) out.push(x); return out; }
function canSum(target, ps) { const dp = Array(target + 1).fill(false); dp[0] = true; for (let i = 1; i <= target; i++) for (const p of ps) if (i >= p && dp[i - p]) { dp[i] = true; break; } return dp[target]; }
function decomps(target, ps, idx = 0, cur = []) { if (target === 0) return [cur]; if (idx >= ps.length) return []; let out = []; for (let c = 0; c <= Math.floor(target / ps[idx]); c++) out.push(...decomps(target - c * ps[idx], ps, idx + 1, cur.concat(Array(c).fill(ps[idx])))); return out; }
function cycles(N, p) { const step = N / p; return Array.from({ length: step }, (_, a) => Array.from({ length: p }, (_, j) => (a + j * step) % N)); }
function cycleSolution(N, K) {
  if (K === 0) return []; if (K === N) return [...Array(N).keys()];
  const ps = factors(N); if (!canSum(K, ps) || !canSum(N - K, ps)) return null;
  const ds = decomps(K, ps).sort((a, b) => a.length - b.length);
  for (const d of ds) {
    const by = d.reduce((m, p) => (m[p] = (m[p] || 0) + 1, m), {}), used = new Set(), picked = [];
    let ok = true;
    for (const p of Object.keys(by).sort((a, b) => b - a)) {
      const avail = cycles(N, +p).filter(c => c.every(i => !used.has(i)));
      if (avail.length < by[p]) { ok = false; break; }
      for (let j = 0; j < by[p]; j++) { const c = avail[j]; c.forEach(i => used.add(i)); picked.push(...c); }
    }
    if (ok && picked.length === K) return picked.sort((a, b) => a - b);
  }
  return null;
}
function metric(pos, N) { let x = 0, y = 0; for (const i of pos) { const a = 2 * Math.PI * i / N; x += Math.cos(a); y += Math.sin(a); } return { x, y, mag: Math.hypot(x, y) }; }

function render() {
  const svg = $('rotor'); svg.innerHTML = '';
  const R = 190, c = 260, m = metric(slots, n), scale = Math.min(110, m.mag * 55);
  svg.insertAdjacentHTML('beforeend', `<circle cx="${c}" cy="${c}" r="${R + 18}" fill="#f8fafc" stroke="#e2e8f0" stroke-width="2"/><circle cx="${c}" cy="${c}" r="${R}" fill="#fff" stroke="#cbd5e1" stroke-width="2"/>`);
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * i / n - Math.PI / 2, x = c + R * Math.cos(a), y = c + R * Math.sin(a), on = slots.includes(i);
    svg.insertAdjacentHTML('beforeend', `<g class="slot" data-i="${i}"><circle cx="${x}" cy="${y}" r="${on ? 13 : 10}" fill="${on ? '#2563eb' : '#e2e8f0'}"/><text x="${c + (R + 32) * Math.cos(a)}" y="${c + (R + 32) * Math.sin(a)}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#64748b">${i + 1}</text></g>`);
  }
  // The slots are drawn with theta = 2πi/n - π/2.  Convert the
  // mathematical resultant (m.x, m.y) into that same screen coordinate
  // system: (cos(theta-π/2), sin(theta-π/2)) = (sin(theta), -cos(theta)).
  if (m.mag > 1e-9) {
    const dx = m.y / m.mag * scale;
    const dy = -m.x / m.mag * scale;
    svg.insertAdjacentHTML('beforeend', `<line x1="${c}" y1="${c}" x2="${c + dx}" y2="${c + dy}" stroke="#f97316" stroke-width="4" stroke-linecap="round"/><circle cx="${c + dx}" cy="${c + dy}" r="6" fill="#f97316"/>`);
  }
  svg.querySelectorAll('.slot').forEach(g => g.addEventListener('click', () => {
    if (mode !== 'manual') return; const i = +g.dataset.i;
    if (slots.includes(i)) slots = slots.filter(x => x !== i); else if (slots.length < k) slots = [...slots, i]; update();
  }));
  $('spinValue').textContent = `|Σspin| = ${m.mag.toFixed(6)}`;
  $('spinBar').style.width = Math.min(100, m.mag * 100) + '%';
  $('spinBar').style.background = m.mag < EPS ? '#16a34a' : '#f97316';
  $('tubeCountLabel').textContent = `${slots.length} / ${k} 支管`;
  if (slots.length === 0) { $('statusValue').textContent = '等待输入'; $('statusValue').style.color = '#172033'; $('statusMeta').textContent = '—'; }
  else if (m.mag < EPS) { $('statusValue').textContent = '已配平 ✓'; $('statusValue').style.color = '#16a34a'; $('statusMeta').textContent = '合力向量为零'; }
  else { $('statusValue').textContent = '未配平'; $('statusValue').style.color = '#ea580c'; $('statusMeta').textContent = '请调整孔位'; }
}
function update() { n = Math.max(2, Math.min(96, +$('nInput').value || 24)); k = Math.max(0, Math.min(n, +$('kInput').value || 0)); $('nInput').value = n; $('kInput').value = k; $('rotorTitle').textContent = `${n} 孔转子`; render(); }
function run() {
  update();
  if (mode === 'manual') { $('sourceBadge').textContent = '手动模式'; return; }
  const entry = table?.rotors?.[String(n)]?.tubeCounts?.[String(k)];
  if (entry?.balanceable) { slots = entry.slotIndices; $('sourceBadge').textContent = '配平表'; }
  else { const sol = cycleSolution(n, k); slots = sol || []; $('sourceBadge').textContent = sol ? '实时计算' : '无可行方案'; if (!sol) { $('statusValue').textContent = '不存在配平方案'; } }
  render();
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active')); b.classList.add('active'); mode = b.dataset.mode;
  $('runButton').textContent = mode === 'auto' ? '生成配平方案' : '进入手动模式';
  $('modeHint').textContent = mode === 'auto' ? '自动模式会优先读取配平表；表中没有时，使用质因数循环构造。' : '点击转子孔位放入或移除离心管，方案会实时更新。';
  if (mode === 'manual') slots = []; run();
}));
$('runButton').addEventListener('click', run);
$('clearButton').addEventListener('click', () => { slots = []; render(); });
$('nInput').addEventListener('change', update); $('kInput').addEventListener('change', update);
update();
