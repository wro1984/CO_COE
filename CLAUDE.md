# CO_COE — Monitor COE

App web instalável no celular (PWA) com o acompanhamento do COE de **hoje, 00:00, até a coleta**, em duas áreas trocadas
no topo: **COE** (elegíveis, Entrantes BD's - Total a cada 15 min, histórico hoje/D7/D14/D21, funil, filas, rede, produto e
CRM) e **Re-teste** (fila, testes, funil, encerramentos automáticos por hora e por código, não recuperados por motivo).
Publicado pelo GitHub Pages em <https://wro1984.github.io/CO_COE/> a partir da branch `main`. **Todo push na `main` vai
para o ar em cerca de 1 minuto**, para todos os usuários.

**Topo padrão dos apps** (igual no Problemas Sistêmicos, no Nível de Serviço e na URA): botão de voltar ao HUB (ícone de
grade, `#btHub`) à esquerda, botões do app à direita. No desktop o topo fica na coluna de 760 px do conteúdo.

Leia este arquivo inteiro antes de mudar qualquer coisa.

## Como funciona

```
.242 (bd_operacao_co) ──► MAPI (coe_app.py) ──► dados.json CIFRADO ──► este repo ──► app no celular
 sessão só leitura          uma consulta por card    (commit automático)              login do HUB
```

- O repositório e o site são **públicos**. Os números só existem aqui **cifrados**, no `dados.json`.
- Quem gera e publica o `dados.json` é o **MAPI** (repositório `wro1984/mapi5`, `coe_app.py`, ver `COE_APP.md` de lá),
  no intervalo e na janela configurados em Comunicação → COE · App.
- **Não há chave própria**: o app abre com a credencial que o HUB dos apps (<https://wro1984.github.io/>) guardou no
  IndexedDB `co-hub-acesso` deste endereço. Quem vê o app é definido no perfil do HUB (app `coe`).
- Cada card vem de uma consulta própria. Se uma falhou, o MAPI manda o nome dela em `erros` e o app mostra só aquele
  card como indisponível.

## Regras que não podem ser quebradas

1. **Nunca editar, apagar ou "consertar" o `dados.json`.** Ele é sobrescrito pelo MAPI várias vezes por hora.
2. **Nunca commitar dados abertos nem segredos** (números reais, prints, JSON decifrado, chaves, tokens). O histórico do
   git é público. Para testar, use `tests/fixtures/pacote.json` (dados inventados, gerado com as funções do MAPI).
3. **Não mudar o formato da criptografia sozinho.** `cripto.js` precisa continuar igual ao que o MAPI gera em `coe_app.py`:
   - `dados.json`: `{app:"co-coe", v:1, gerado_em, hub:{acessos:{id_hub:{salt, iv, ct}}}, dados:{iv, ct}}`;
   - `id_hub` = SHA-256 de `"hub:" + MATRÍCULA`, `salt` = o do HUB (diferente: a chave do HUB foi trocada);
   - `ct` do acesso = a chave dos dados (AES-GCM 256) cifrada com a chave do HUB; `dados.ct` = o JSON do monitor.
   Mudança aqui tem que ser feita **junto** no MAPI.
4. **A credencial do HUB só é LIDA**: nunca apagar, copiar ou criar o banco `co-hub-acesso` (sair de todos os apps é no HUB).
5. **O service worker (`sw.js`) só mexe no que é deste app**: caches que começam com `co-coe-v` e pedidos dentro de
   `/CO_COE/`. Outros apps moram no mesmo endereço; apagar o cache deles quebra o offline de todo mundo.
6. **Não carregar nada de fora**: sem CDNs, fontes externas, analytics (o `index.html` tem CSP `default-src 'self'`).
7. Acesso perdido (sem o app no perfil, chave do HUB trocada): o app apaga a cópia cifrada do `dados.json` do cache.

## Formato do JSON aberto (o que a tela usa)

`{referencia, coletado_em, periodo:{de, ate}, coe:{kpis, e15, funil, hist, filas, rede, produto, crm}, rt:{aguardando,
navez, testes, ultimo_min, funil, por_hora, codigos, motivos}, erros:{<consulta>: <mensagem>}}`. Um bloco que falhou
**não vem** (e o nome da consulta está em `erros`): o app tem que aguentar qualquer bloco ausente.

## Onde mexer

| Quero mudar… | Onde |
|---|---|
| Cores, tamanhos, modo escuro | `<style>` no `index.html` (variáveis em `:root`) |
| Cards de cada área, textos do ⓘ | `telaCoe()`, `telaRt()` e `INFO` em `app.js` |
| Gráficos de linhas (legenda liga/desliga, leitura do horário) | `multi()` em `app.js`; contas em `grafico.js` |
| Encerramentos por hora (Colunas, Lista, Acumulado) | `encerramentos()` em `app.js` |
| Limite de "parado" (integração, job de re-teste) | `PARADO_MIN` em `app.js` |
| **Quais números vêm, regra do re-teste, consultas** | **não é aqui**: é o `coe_app.py` do MAPI |

## Antes de cada push

1. **Versão igual** em `APP_VERSION` (`app.js`), `VERSAO` (`cripto.js`), `VERSION` (`sw.js`) e nos `?v=` do `index.html`.
   Com versões diferentes o app se recarrega até elas baterem.
2. Arquivo novo que o app usa? Inclua em `CORE` no `sw.js`.
3. `npm test` e teste no navegador em ~390 px, claro e escuro.
4. `git pull` antes do push (o MAPI faz commits no `dados.json`). Use merge, não force-push.

## Testar localmente, sem dados reais

```
# pacote de teste com as funções do MAPI (dados inventados), pessoa A0001 / lago-vento-pedra
MAPI_DIR=../mapi5 python tests/gerar_fixture.py
mkdir -p /tmp/site/CO_COE && cp -r index.html *.js manifest.webmanifest icons /tmp/site/CO_COE/
python -c "import json;json.dump(json.load(open('tests/fixtures/pacote.json'))['pacote'],open('/tmp/site/CO_COE/dados.json','w'))"
cd /tmp/site && python -m http.server 8000          # http://localhost:8000/CO_COE/
```

Sem a credencial do HUB no navegador o app mostra "Entre pelo HUB". Para testar, sirva também o HUB na raiz com um
`hub.json` de teste da mesma pessoa, ou grave a credencial no IndexedDB (veja `credDoHub()` em `tests/cripto.test.js`).
**Não commite** um `dados.json` de teste no lugar do publicado pelo MAPI.

## Estrutura

| Arquivo | Papel |
|---|---|
| `index.html` | estrutura, estilos (paleta da empresa, modo escuro), CSP, troca COE / Re-teste |
| `app.js` | telas das duas áreas, ⓘ de cada card, gráficos com toque; conferência a cada minuto |
| `grafico.js` | contas dos gráficos (escala, acumulado, toque); roda também no Node |
| `cripto.js` | lê a credencial do HUB e abre o `dados.json` |
| `sw.js` | cache offline só deste app |
| `manifest.webmanifest`, `icons/` | instalação no celular |
| `tests/` | criptografia (pacote do MAPI), gráficos e versões |
| `dados.json` | **gerado pelo MAPI — não editar** |
