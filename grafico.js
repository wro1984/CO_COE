/* Monitor COE — contas dos gráficos (sem DOM; roda também no Node, para os testes).
 *
 * multi():   gráfico de linhas com várias séries (Entrantes BD's - Total, Histórico, Acumulado). Escala pelo maior valor
 *            das séries VISÍVEIS, arredondado para cima num número "redondo".
 * colunas(): encerramentos por hora em colunas.
 * acumulado(), indiceDoToque(), cortarFuturo(): apoio.
 */
(function (root) {
  'use strict';

  // topo da escala: o menor 1, 1,5, 2, 2,5, 3, 4, 5, 6, 8 × 10^n que cabe o máximo
  function topoEscala(max) {
    if (!(max > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * p >= max - 1e-9) return f * p;
    return max;
  }

  const acumulado = v => { let s = 0; return (v || []).map(x => (x == null ? null : (s += x))); };

  // horas de "hoje" depois de agora não existem ainda: viram null (as de D7/D14/D21 ficam)
  function cortarFuturo(horas, valores, ateHHMM) {
    const h = parseInt(String(ateHHMM || '').slice(0, 2), 10);
    if (isNaN(h)) return valores.slice();
    return valores.map((v, i) => (parseInt(horas[i], 10) > h ? null : v));
  }

  // geometria de linhas. series: [{k, valores}], off: {k:true} escondidas
  function multi(rotulos, series, off, w, h) {
    const vis = series.filter(s => !(off && off[s.k]));
    const max = Math.max(0, ...vis.flatMap(s => s.valores.filter(v => v != null)));
    const topo = topoEscala(max);
    const x0 = 34, x1 = w - 6, y0 = h - 16, y1 = 6, N = rotulos.length;
    const X = i => (N > 1 ? x0 + (x1 - x0) * i / (N - 1) : (x0 + x1) / 2);
    const Y = v => y0 - (y0 - y1) * v / topo;
    const pts = d => d.map((v, i) => (v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean).join(' ');
    return {
      x0, x1, y0, y1, N, topo, X, Y,
      grade: [0, 0.5, 1].map(f => ({ y: Y(topo * f), v: Math.round(topo * f) })),
      linhas: vis.map(s => ({ k: s.k, pontos: pts(s.valores) }))
    };
  }

  // toque (x em unidades do viewBox) -> índice do rótulo mais perto
  function indiceDoToque(x, x0, x1, N) {
    if (N <= 1) return 0;
    return Math.max(0, Math.min(N - 1, Math.round((x - x0) / (x1 - x0) * (N - 1))));
  }

  function colunas(valores, w, h) {
    const m = Math.max(1, ...valores), x0 = 2, bw = (w - x0) / Math.max(1, valores.length), base = h - 12;
    return {
      bw, base,
      barras: valores.map((v, i) => { const alt = (base - 14) * (v || 0) / m; return { x: x0 + i * bw, y: base - alt, alt, v: v || 0 }; })
    };
  }

  const api = { topoEscala, acumulado, cortarFuturo, multi, indiceDoToque, colunas };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.COEGrafico = api;
})(typeof self !== 'undefined' ? self : globalThis);
