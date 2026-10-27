// Contas dos gráficos (grafico.js), sem navegador.
const test = require('node:test');
const assert = require('node:assert');
const G = require('../grafico.js');

test('topo da escala é um número redondo que cabe o máximo', () => {
  assert.strictEqual(G.topoEscala(0), 1);
  assert.strictEqual(G.topoEscala(7), 8);
  assert.strictEqual(G.topoEscala(270), 300);
  assert.strictEqual(G.topoEscala(1370), 1500);
  assert.strictEqual(G.topoEscala(1000), 1000);
});

test('acumulado do dia', () => {
  assert.deepStrictEqual(G.acumulado([1, 2, 0, 5]), [1, 3, 3, 8]);
  assert.deepStrictEqual(G.acumulado([]), []);
});

test('hoje não tem as horas depois de agora; D7 continua', () => {
  const horas = ['13h', '14h', '15h', '16h'];
  assert.deepStrictEqual(G.cortarFuturo(horas, [5, 6, 0, 0], '14:20'), [5, 6, null, null]);
  assert.deepStrictEqual(G.cortarFuturo(horas, [5, 6, 7, 8], ''), [5, 6, 7, 8]);
});

test('escala segue só as séries visíveis', () => {
  const s = [{ k: 'a', valores: [10, 270] }, { k: 'b', valores: [1, 4] }];
  assert.strictEqual(G.multi(['08:00', '08:15'], s, {}, 300, 150).topo, 300);
  const so = G.multi(['08:00', '08:15'], s, { a: true }, 300, 150);
  assert.strictEqual(so.topo, 4);
  assert.deepStrictEqual(so.linhas.map(l => l.k), ['b']);
});

test('linha pula os nulos e um ponto só não quebra', () => {
  const g = G.multi(['a', 'b', 'c'], [{ k: 'x', valores: [1, null, 3] }], {}, 300, 100);
  assert.strictEqual(g.linhas[0].pontos.split(' ').length, 2);
  const um = G.multi(['a'], [{ k: 'x', valores: [5] }], {}, 300, 100);
  assert.ok(!um.linhas[0].pontos.includes('NaN'));
});

test('toque vira o índice mais perto, sem sair da série', () => {
  assert.strictEqual(G.indiceDoToque(34, 34, 294, 5), 0);
  assert.strictEqual(G.indiceDoToque(294, 34, 294, 5), 4);
  assert.strictEqual(G.indiceDoToque(170, 34, 294, 5), 2);
  assert.strictEqual(G.indiceDoToque(-50, 34, 294, 5), 0);
  assert.strictEqual(G.indiceDoToque(999, 34, 294, 5), 4);
});

test('colunas: a maior ocupa a altura útil, zero fica sem altura', () => {
  const c = G.colunas([0, 5, 10], 300, 100);
  assert.strictEqual(c.barras[0].alt, 0);
  assert.strictEqual(c.barras[2].alt, 100 - 12 - 14);
  assert.strictEqual(c.barras.length, 3);
  assert.strictEqual(G.colunas([0, 0], 300, 100).barras[1].alt, 0);
});
