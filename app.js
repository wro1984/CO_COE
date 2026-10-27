/* Monitor COE — telas.
 *
 * Fluxo: credencial do HUB neste aparelho -> baixa o dados.json (sempre da rede, cópia no cache para offline) ->
 * abre com cripto.js -> desenha. Confere de novo a cada minuto com o app aberto e ao voltar para ele.
 * Nada aberto é guardado no aparelho: só o dados.json cifrado, no cache do service worker.
 *
 * Duas áreas, trocadas no topo: COE e Re-teste. Período sempre de hoje, 00:00, até a coleta.
 * Cada card vem de uma consulta própria no MAPI: se ela falhou, o card aparece como indisponível (campo `erros`).
 */
(function () {
  'use strict';

  const APP_VERSION = '1.0.0';
  const CONFERIR_MS = 60 * 1000;
  const FRESCO_MIN = 15;              // coleta mais velha que isso: o ponto do topo fica cinza
  const PARADO_MIN = 10;              // integração ou job de re-teste sem andar há mais que isso: alerta
  const HUB_URL = new URL('/', location.href).href;

  const G = window.COEGrafico, K = window.COECripto;
  const $ = id => document.getElementById(id);
  const esc = v => v == null ? '' : String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('pt-BR');
  const n = v => v == null ? '—' : nf.format(v);
  const pct = v => v == null ? '—' : String(Math.round(Number(v) * 10) / 10).replace('.', ',') + '%';
  const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dataBR = iso => iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
  const horaDe = iso => (iso || '').slice(11, 16) || '—';
  const minEntre = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return isNaN(x) || isNaN(y) ? null : Math.max(0, Math.round((y - x) / 60000)); };

  let dados = null, cred = null, gerado = null;
  let area = 'coe';
  const abertos = {};                 // ⓘ abertos (sobrevivem ao redesenho)
  const ESTADO = { e15: { off: {}, sel: null }, hist: { off: {}, sel: null }, acum: { off: {}, sel: null }, enc: { forma: 'col', sel: null } };

  const INFO = {
    eleg_hoje: 'BDs elegíveis que entraram hoje: na fila (agendada, pendente agendamento ou triagem), com sincronismo, carga e conexão válidos, sem repetido, ouvidoria nem passagem em campo.',
    eleg_hora: 'Mesma regra dos elegíveis, só os que integraram na última hora.',
    online: 'Colaboradores com sessão aberta no momento da coleta.',
    integ: 'Hora da integração mais recente na fila. Se parar de andar, a integração travou.',
    e15: 'A cada 15 min, de hoje até agora: entrantes, ouvidoria, repetidos, sincronizados, conectados e elegíveis (mesma conta do Grafana). Toque na legenda para esconder uma linha e no gráfico para ler um horário.',
    hist: 'Entrantes por hora hoje contra o mesmo dia da semana há 7, 14 e 21 dias (fila e expurgo).',
    funil: 'Dos BDs que entraram hoje: quantos estão sincronizados, conectados e elegíveis.',
    filas: 'Situação atual dos BDs elegíveis na fila do COE.',
    rede: 'Entrantes de hoje por rede (skill).',
    produto: 'Entrantes de hoje por produto (skill).',
    crm: 'Entrantes de hoje por CRM: Sophia (PON com hífen) ou NEXT.',
    agu: 'PONs com re-teste pendente dentro da regra (sem repetido, passagem em campo, ouvidoria e Anatel), ainda na fila.',
    navez: 'Re-teste liberado (passaram 30 min do último teste) e ainda não pego. Crescendo sem parar = o job não está dando conta.',
    ult: 'Minutos desde o último teste de sincronismo gravado. Acima de 10 min em operação = job parado.',
    testes: 'Todos os testes de sincronismo de hoje (primeiro teste e re-testes).',
    funilRt: 'PONs dentro da regra que deram DOWN/NOT_CONFIGURED hoje; quantas voltaram UP e quantas o re-teste encerrou.',
    hora: 'Encerramentos automáticos de hoje (matrícula RBCOSP04) por hora. Escolha a forma: colunas (toque numa coluna para o detalhe por código), lista ou acumulado do dia.',
    cod: 'Encerramentos automáticos de hoje, por código.',
    motivos: 'Dos que entraram em re-teste e não foram encerrados: em que situação pararam.'
  };

  // ---------- dados ----------
  async function baixar() {
    const r = await fetch('dados.json', { cache: 'no-store' });
    if (r.status === 404) { const e = new Error('Ainda não há dados publicados.'); e.code = 'sem_dados'; throw e; }
    if (!r.ok) throw new Error('Não consegui baixar os dados (HTTP ' + r.status + ').');
    return r.json();
  }

  // acesso perdido: tira do cache do aparelho a cópia (cifrada) dos dados
  async function apagarCopia() {
    if (!('caches' in window)) return;
    try {
      for (const k of await caches.keys()) {
        if (!k.startsWith('co-coe-v')) continue;
        const c = await caches.open(k);
        for (const req of await c.keys()) if (new URL(req.url).pathname.endsWith('/dados.json')) await c.delete(req);
      }
    } catch (e) { /* sem cache: nada a apagar */ }
  }

  async function carregar() {
    cred = await K.lerCredHub();
    if (!cred) { dados = null; await apagarCopia(); return telaAviso('Entre pelo HUB',
      'Este app abre com o login do HUB dos apps. Entre no HUB com sua matrícula e chave e toque no atalho do Monitor COE.', true); }
    let pacote;
    try { pacote = await baixar(); }
    catch (e) {
      if (dados) return marcarOffline(true);
      return telaAviso(e.code === 'sem_dados' ? 'Sem dados ainda' : 'Sem conexão', e.message, false);
    }
    if (pacote.gerado_em && pacote.gerado_em === gerado && dados) { marcarOffline(false); return desenhar(); }
    try {
      dados = await K.abrir(pacote, cred);
      gerado = pacote.gerado_em || null;
    } catch (e) {
      if (e.code === 'sem_acesso') { dados = null; await apagarCopia(); return telaAviso('Sem acesso', e.message, true); }
      return telaAviso('Não deu para abrir', e.message, false);
    }
    marcarOffline(false);
    desenhar();
  }

  function marcarOffline(sim) {
    const o = $('offline');
    o.hidden = !sim;
    o.textContent = sim ? 'Sem conexão: mostrando os últimos dados abertos.' : '';
  }

  // ---------- peças ----------
  const btInfo = k => `<button type="button" class="info" data-info="${k}" aria-expanded="${!!abertos[k]}" aria-controls="i-${k}" aria-label="O que é este número">i</button>`;
  const desc = k => `<div class="desc" id="i-${k}"${abertos[k] ? '' : ' hidden'}>${esc(INFO[k])}</div>`;
  const indisp = () => '<p class="vazio">Indisponível agora: a consulta deste card falhou no MAPI. Os outros cards seguem normais.</p>';

  function sec(titulo, k, corpo, extra) {
    return `<section class="sec"><h3><span class="tt">${esc(titulo)}</span>${extra || ''}${btInfo(k)}</h3>${desc(k)}${corpo}</section>`;
  }
  function kpi(nome, k, valor, legenda, destaque) {
    return `<div class="k${destaque ? ' destaque' : ''}"><span class="n"><span>${esc(nome)}</span>${btInfo(k)}</span>${desc(k)}<span class="v num">${esc(valor)}</span>${legenda ? `<span class="l">${legenda}</span>` : ''}</div>`;
  }
  const CORES = ['--s1', '--s2', '--s3', '--s4', '--s5'];
  function barras(lista, cor) {
    if (!lista || !lista.length) return '<p class="vazio">Nada hoje até agora.</p>';
    const m = Math.max(1, ...lista.map(x => x[1]));
    return `<div class="barras">${lista.map(([r, v], j) => `<div class="barra"><span>${esc(r)}</span><b class="num">${n(v)}</b><span class="tr"><i style="width:${(100 * v / m).toFixed(1)}%;background:var(${cor || CORES[j % 5]})"></i></span></div>`).join('')}</div>`;
  }
  function funil(lista, recuperacao) {
    const m = Math.max(1, lista[0][1]);
    return `<div class="funil">${lista.map(([r, v], j) => `<div class="f"><span class="bx num" style="width:${Math.max(18, 100 * v / m).toFixed(0)}%;background:var(${['--s1', '--s2', '--s4', '--s3'][j]})">${n(v)}</span><small>${esc(r)}</small></div>`).join('')}${recuperacao !== undefined ? `<div class="f"><small>Recuperação: <b class="num">${pct(recuperacao)}</b></small></div>` : ''}</div>`;
  }

  // gráfico de linhas com legenda que liga/desliga e leitura do horário tocado
  function multi(id, rotulos, series, w, h, passoRot) {
    const st = ESTADO[id];
    if (st.sel != null && st.sel >= rotulos.length) st.sel = null;
    const geo = G.multi(rotulos, series, st.off, w, h);
    const cor = k => series.find(s => s.k === k).cor;
    const grade = geo.grade.map(l => `<line x1="${geo.x0}" y1="${l.y.toFixed(1)}" x2="${geo.x1}" y2="${l.y.toFixed(1)}" stroke="var(--line)"/><text x="${geo.x0 - 4}" y="${(l.y + 3).toFixed(1)}" text-anchor="end">${esc(n(l.v))}</text>`).join('');
    const rx = rotulos.map((t, i) => (i % passoRot === 0 ? `<text x="${geo.X(i).toFixed(1)}" y="${h - 4}" text-anchor="middle">${esc(t)}</text>` : '')).join('');
    const linhas = geo.linhas.map(l => `<polyline fill="none" stroke="var(${cor(l.k)})" stroke-width="${series[0].k === l.k ? 2.4 : 1.8}" stroke-linejoin="round" points="${l.pontos}"/>`).join('');
    const vis = series.filter(s => !st.off[s.k]);
    const sel = st.sel == null ? '' : `<line x1="${geo.X(st.sel).toFixed(1)}" y1="${geo.y1}" x2="${geo.X(st.sel).toFixed(1)}" y2="${geo.y0}" stroke="var(--ink3)" stroke-dasharray="2 3"/>` +
      vis.map(s => (s.valores[st.sel] == null ? '' : `<circle cx="${geo.X(st.sel).toFixed(1)}" cy="${geo.Y(s.valores[st.sel]).toFixed(1)}" r="3" fill="var(${s.cor})"/>`)).join('');
    const leit = st.sel == null ? 'Toque no gráfico para ver os valores de um horário.'
      : `<b>${esc(rotulos[st.sel])}</b> · ` + vis.map(s => `${esc(s.nome)} ${esc(n(s.valores[st.sel]))}`).join(' · ');
    return `<svg class="graf" viewBox="0 0 ${w} ${h}" role="img" aria-label="Gráfico de linhas" data-graf="${id}" data-n="${geo.N}" data-x0="${geo.x0}" data-x1="${geo.x1}" data-w="${w}">${grade}${rx}${linhas}${sel}</svg>
      <div class="leit" aria-live="polite">${leit}</div>
      ${series.length > 1 ? `<div class="leg">${series.map(s => { const ult = [...s.valores].reverse().find(v => v != null); return `<button type="button" data-serie="${id}:${s.k}" aria-pressed="${!st.off[s.k]}"><i style="background:var(${s.cor})"></i>${esc(s.nome)} <b class="num">${esc(n(ult == null ? 0 : ult))}</b></button>`; }).join('')}</div>` : ''}`;
  }

  // encerramentos por hora: colunas (padrão), lista ou acumulado
  function encerramentos(ph) {
    const st = ESTADO.enc, v = ph.total, rot = ph.horas;
    const seletor = `<div class="mini" role="group" aria-label="Forma">${[['col', 'Colunas'], ['lista', 'Lista'], ['acum', 'Acumulado']].map(([k, r]) => `<button type="button" data-forma="${k}" aria-pressed="${st.forma === k}">${r}</button>`).join('')}</div>`;
    const totalDia = v.reduce((a, b) => a + b, 0);
    let corpo;
    if (!totalDia) corpo = '<p class="vazio">Nenhum encerramento automático hoje até agora.</p>';
    else if (st.forma === 'lista') {
      const m = Math.max(1, ...v);
      corpo = `<div class="lst">${v.map((x, i) => `<span class="num">${esc(rot[i])}</span><span class="tr"><i style="width:${(100 * x / m).toFixed(1)}%"></i></span><b class="num">${n(x)}</b>`).join('')}</div>`;
    } else if (st.forma === 'acum') {
      corpo = multi('acum', rot, [{ k: 'acum', nome: 'Acumulado do dia', cor: '--s4', valores: G.acumulado(v) }], 300, 120, 3);
    } else {
      const w = 300, h = 100, geo = G.colunas(v, w, h);
      if (st.sel != null && st.sel >= v.length) st.sel = null;
      const cols = geo.barras.map((b, i) => `<rect x="${(b.x + 1).toFixed(1)}" y="${b.y.toFixed(1)}" width="${Math.max(1, geo.bw - 2).toFixed(1)}" height="${b.alt.toFixed(1)}" rx="2" fill="var(${st.sel === i ? '--s1' : '--s4'})"/>` +
        (b.v ? `<text x="${(b.x + geo.bw / 2).toFixed(1)}" y="${(b.y - 3).toFixed(1)}" text-anchor="middle" class="vl">${b.v}</text>` : '') +
        `<rect x="${b.x.toFixed(1)}" y="0" width="${geo.bw.toFixed(1)}" height="${h}" fill="transparent" data-col="${i}"><title>${esc(rot[i])}: ${b.v}</title></rect>`).join('');
      const passo = v.length > 12 ? 6 : 3;
      const rx = rot.map((t, i) => (i % passo === 0 || i === v.length - 1 ? `<text x="${(2 + i * geo.bw + geo.bw / 2).toFixed(1)}" y="${h - 2}" text-anchor="middle">${esc(t)}</text>` : '')).join('');
      const det = st.sel == null ? 'Toque numa coluna para ver o detalhe por código.'
        : `<b>${esc(rot[st.sel])}</b> · ${n(v[st.sel])} encerramentos` + Object.entries(ph.por_codigo || {}).filter(([, x]) => x[st.sel]).sort((a, b) => b[1][st.sel] - a[1][st.sel]).map(([c, x]) => ` · ${esc(c)}: ${n(x[st.sel])}`).join('');
      corpo = `<svg class="graf" viewBox="0 0 ${w} ${h}" role="img" aria-label="Encerramentos por hora">${cols}${rx}</svg><div class="leit" aria-live="polite">${det}</div>`;
    }
    return { seletor, corpo: corpo + `<span class="toque">Total hoje: <b class="num">${n(totalDia)}</b></span>` };
  }

  // ---------- áreas ----------
  function telaCoe(c, erros, ate, coletado) {
    const kp = c.kpis || {};
    const semKpi = erros.eleg || erros.online || erros.integracao;
    const integMin = kp.ultima_integracao ? minEntre(kp.ultima_integracao, coletado) : null;
    const chipInteg = integMin == null ? '' : `<span class="chip ${integMin > PARADO_MIN ? 'bad' : 'ok'}">há ${n(integMin)} min</span>`;
    const out = [`<div class="g2">${kpi('Elegíveis hoje', 'eleg_hoje', erros.eleg ? '—' : n(kp.eleg_hoje), 'desde 00:00', true)}${kpi('Elegíveis última hora', 'eleg_hora', erros.eleg ? '—' : n(kp.eleg_hora), 'última hora')}${kpi('Usuários online', 'online', erros.online ? '—' : n(kp.online), 'na coleta')}${kpi('Última integração', 'integ', erros.integracao ? '—' : horaDe(kp.ultima_integracao), chipInteg)}</div>` +
      (semKpi ? '<p class="vazio">Algum número acima está indisponível agora (consulta falhou no MAPI).</p>' : '')];

    if (c.e15 && c.e15.slots.length) {
      const S = c.e15.series;
      out.push(sec("Entrantes BD's - Total", 'e15', multi('e15', c.e15.slots, [
        { k: 'entrantes', nome: 'Volume de entrantes', cor: '--s4', valores: S.entrantes },
        { k: 'ouvidoria', nome: 'Ouvidoria', cor: '--s3', valores: S.ouvidoria },
        { k: 'repetidos', nome: 'Repetidos', cor: '--s2', valores: S.repetidos },
        { k: 'sincronizados', nome: 'Sincronizados', cor: '--warn', valores: S.sincronizados },
        { k: 'conectados', nome: 'Conectados', cor: '--bad', valores: S.conectados },
        { k: 'elegiveis', nome: 'Elegíveis', cor: '--s1', valores: S.elegiveis }], 300, 150, c.e15.slots.length > 24 ? 8 : 4)));
    } else out.push(sec("Entrantes BD's - Total", 'e15', erros.e15 ? indisp() : '<p class="vazio">Nenhum entrante hoje até agora.</p>'));

    if (c.hist && c.hist.horas.length) {
      const H = c.hist;
      out.push(sec('Histórico de entrantes: hoje, D7, D14, D21', 'hist', multi('hist', H.horas, [
        { k: 'hoje', nome: 'Hoje', cor: '--bad', valores: G.cortarFuturo(H.horas, H.hoje, ate) },
        { k: 'd7', nome: 'D7', cor: '--s4', valores: H.d7 },
        { k: 'd14', nome: 'D14', cor: '--s1', valores: H.d14 },
        { k: 'd21', nome: 'D21', cor: '--s2', valores: H.d21 }], 300, 140, 3)));
    } else out.push(sec('Histórico de entrantes: hoje, D7, D14, D21', 'hist', erros.hist ? indisp() : '<p class="vazio">Sem entrantes no histórico.</p>'));

    out.push(sec('Dos entrantes, quantos são elegíveis', 'funil', c.funil ? funil([['Entrantes', c.funil.entrantes], ['Sincronizados', c.funil.sincronizados],
      ['Conectados', c.funil.conectados], ['Elegíveis', c.funil.elegiveis]]) : indisp()));
    out.push(sec('Status das filas', 'filas', c.filas ? `<div class="chips">${c.filas.map(([r, v]) => `<div class="c">${esc(r)}<b class="num">${n(v)}</b></div>`).join('')}</div>` : indisp()));
    out.push(sec('Rede', 'rede', c.rede ? barras(c.rede) : indisp()));
    out.push(sec('Produto', 'produto', c.produto ? barras(c.produto) : indisp()));
    out.push(sec('CRM', 'crm', c.crm ? barras(c.crm) : indisp()));
    return out.join('');
  }

  function telaRt(r, erros) {
    const t = r.testes || {};
    const ult = r.ultimo_min;
    const chipUlt = ult == null ? '' : `<span class="chip ${ult > PARADO_MIN ? 'bad' : 'ok'}">${ult > PARADO_MIN ? 'job parado?' : 'job rodando'}</span>`;
    const out = [`<div class="g2">${kpi('Aguardando re-teste', 'agu', erros.rt_fila ? '—' : n(r.aguardando), 'dentro da regra', true)}${kpi('Na vez agora', 'navez', erros.rt_fila ? '—' : n(r.navez), 'liberados, não pegos')}${kpi('Último teste', 'ult', erros.rt_testes || ult == null ? '—' : n(ult) + ' min', chipUlt)}${kpi('Testes hoje', 'testes', erros.rt_testes ? '—' : n(t.total), erros.rt_testes ? '' : `${pct(t.pct_up)} UP · ${pct(t.pct_erro)} erro`)}</div>` +
      (erros.rt_fila || erros.rt_testes ? '<p class="vazio">Algum número acima está indisponível agora (consulta falhou no MAPI).</p>' : '')];
    out.push(sec('Funil do re-teste hoje', 'funilRt', r.funil ? funil([['Entraram em re-teste', r.funil.entraram], ['Voltaram UP', r.funil.voltaram],
      ['Encerrados pelo re-teste', r.funil.encerrados]], r.funil.pct) : indisp()));
    if (r.por_hora) { const e = encerramentos(r.por_hora); out.push(sec('Encerramentos automáticos por hora', 'hora', e.corpo, e.seletor)); }
    else out.push(sec('Encerramentos automáticos por hora', 'hora', indisp()));
    out.push(sec('Encerramentos por código', 'cod', r.codigos ? barras(r.codigos, '--s4') : indisp()));
    out.push(sec('Não recuperados, por motivo', 'motivos', r.motivos ? barras(r.motivos, '--s5') : indisp()));
    return out.join('');
  }

  // ---------- telas ----------
  function telaAviso(titulo, texto, comHub) {
    $('areas').hidden = true;
    $('sub').innerHTML = '';
    $('conteudo').innerHTML = `<div class="aviso-tela"><div class="ic" aria-hidden="true">🛰️</div><h2>${esc(titulo)}</h2><p>${esc(texto)}</p>
      ${comHub ? `<a class="bt" href="${esc(HUB_URL)}">Abrir o HUB</a>` : '<button type="button" class="bt" id="btTentar">Tentar de novo</button>'}</div>`;
    const t = $('btTentar');
    if (t) t.onclick = () => carregar();
    $('rodape').textContent = 'v' + APP_VERSION;
  }

  function desenhar() {
    if (!dados) return;
    const d = dados, erros = d.erros || {};
    const ate = (d.periodo && d.periodo.ate) || horaDe(d.coletado_em);
    // coletado_em vem sem fuso (hora de Brasília): o navegador lê como hora local do aparelho
    const fresco = d.referencia === hojeISO() && Date.now() - Date.parse(d.coletado_em) <= FRESCO_MIN * 60000;
    $('sub').innerHTML = `<span class="vivo${fresco ? '' : ' parado'}" aria-hidden="true"></span> Coleta às ${esc(horaDe(d.coletado_em))}`;
    const seg = $('areas');
    seg.hidden = false;
    seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.area === area)));
    const aviso = d.referencia && d.referencia !== hojeISO()
      ? `<div class="faixa">Dados de ${esc(dataBR(d.referencia))}: a publicação de hoje ainda não começou.</div>` : '';
    const periodo = `<div class="periodo"><span>Período: <b>${d.referencia === hojeISO() || !d.referencia ? 'hoje' : esc(dataBR(d.referencia))}, ${esc((d.periodo && d.periodo.de) || '00:00')} → ${esc(ate)}</b></span></div>`;
    const y = window.scrollY;
    $('conteudo').innerHTML = aviso + periodo + (area === 'coe' ? telaCoe(d.coe || {}, erros, ate, d.coletado_em) : telaRt(d.rt || {}, erros));
    window.scrollTo(0, y);
    $('rodape').textContent = `v${APP_VERSION}` + (cred && cred.matricula ? ` · entrou pelo HUB (${cred.matricula})` : '');
  }

  function aoTocar(ev) {
    const i = ev.target.closest('[data-info]');
    if (i) { const k = i.dataset.info; abertos[k] = !abertos[k]; i.setAttribute('aria-expanded', String(abertos[k])); $('i-' + k).hidden = !abertos[k]; return; }
    const sr = ev.target.closest('[data-serie]');
    if (sr) { const [g, k] = sr.dataset.serie.split(':'); ESTADO[g].off[k] = !ESTADO[g].off[k]; return desenhar(); }
    const fm = ev.target.closest('[data-forma]');
    if (fm) { ESTADO.enc.forma = fm.dataset.forma; ESTADO.enc.sel = null; ESTADO.acum.sel = null; return desenhar(); }
    const col = ev.target.closest('[data-col]');
    if (col) { const k = +col.dataset.col; ESTADO.enc.sel = ESTADO.enc.sel === k ? null : k; return desenhar(); }
    const gf = ev.target.closest('[data-graf]');
    if (gf) {
      const r = gf.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * (+gf.dataset.w);
      ESTADO[gf.dataset.graf].sel = G.indiceDoToque(x, +gf.dataset.x0, +gf.dataset.x1, +gf.dataset.n);
      return desenhar();
    }
  }

  // ---------- início ----------
  function iniciar() {
    $('btHub').href = HUB_URL;
    $('btAtualizar').onclick = () => carregar();
    $('conteudo').addEventListener('click', aoTocar);
    $('areas').querySelectorAll('button').forEach(b => { b.onclick = () => { area = b.dataset.area; desenhar(); window.scrollTo(0, 0); }; });
    if (K.VERSAO !== APP_VERSION) {         // arquivos de versões diferentes no cache: atualiza antes de abrir
      telaAviso('Atualizando', 'Uma versão nova do app chegou. Recarregando…', false);
      setTimeout(() => location.reload(), 1500);
      return;
    }
    carregar();
    setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, CONFERIR_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') carregar(); });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.COEApp = { APP_VERSION };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
