"""Gera tests/fixtures/pacote.json com as funções do PRÓPRIO MAPI (coe_app.py), com dados inventados.

    MAPI_DIR=/caminho/do/mapi5 python tests/gerar_fixture.py

A pessoa de teste é A0001 / lago-vento-pedra (a mesma do pacote de exemplo do HUB). Os números são inventados por um
gerador fixo (mesma semente, mesmo arquivo): nada real.
"""
import base64
import json
import os
import random
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.environ["MAPI_DIR"])
import coe_app  # noqa: E402
import hub  # noqa: E402

MAT, CHAVE = "A0001", "lago-vento-pedra"
AGORA = datetime(2026, 10, 28, 14, 20)
rnd = random.Random(7)


class Inventadas(coe_app.Consultor):
    """Responde cada consulta do coe_app com números inventados (sem banco)."""

    def __init__(self):
        super().__init__(conn=None)

    def linhas(self, chave, sql):
        if chave == "e15":
            out, t = [], datetime(2026, 10, 28, 6, 0)
            while t < AGORA:
                e = rnd.randint(120, 300)
                s = int(e * rnd.uniform(.3, .4))
                out.append({"slot": t, "entrantes": e, "ouvidoria": rnd.randint(0, 4), "repetidos": int(e * .12),
                            "sincronizados": s, "conectados": int(s * .8), "elegiveis": int(s * .6)})
                t += timedelta(minutes=15)
            return out
        if chave == "hist":
            out = []
            for d in ("hoje", "d7", "d14", "d21"):
                for h in range(6, 15 if d == "hoje" else 22):
                    out.append({"d": d, "h": h, "n": rnd.randint(300, 1200)})
            return out
        if chave == "rt_encerramentos":
            return [{"hora": h, "codigo": c, "n": rnd.randint(1, 60 if c == 174 else 6)}
                    for h in range(0, 15) for c in (174, 151, 10860, 10829) if rnd.random() > .3]
        return {
            "eleg": [{"hoje": 1111, "ultima_hora": 55}],
            "online": [{"online": 7}],
            "integracao": [{"ultima": datetime(2026, 10, 28, 14, 18, 5)}],
            "filas": [{"EM TRATATIVA": 40, "AGUARDANDO TRATATIVA": 300, "AGENDADO": 90, "PENDENTE TECNICA": 30}],
            "totais": [{"vivo1": 5000, "vivo2": 3000, "atc": 800, "fibrasil": 500, "banda": 6000, "tv": 900, "linha": 2400,
                        "sophia": 4100, "next": 5200}],
            "rt_fila": [{"aguardando": 3000, "navez": 1500}],
            "rt_testes": [{"testes": 100000, "pct_up": 20.5, "pct_erro": 5.5, "pons": 15000, "ultimo_min": 1}],
            "rt_funil": [{"entraram": 5000, "voltaram": 700, "encerrados": 600}],
            "d7": [{"hoje": 7506, "d7": 8000}],
            "rt_d7": [{"testes": 90000, "encerrados": 400}],
            "rt_motivos": [{"motivo": "Segue DOWN", "n": 3000}, {"motivo": "Saiu da fila no WFM", "n": 900},
                           {"motivo": "Ainda não re-testado", "n": 300}],
        }[chave]


salt = os.urandom(16)
segredo = os.urandom(32)                       # segredo de aviso (push) inventado, vai cifrado em `tk`
pessoa = {"matricula": MAT, "salt": salt, "chave": hub.chave_do_codigo(CHAVE, salt), "push_secret": segredo}
conteudo = json.loads(json.dumps(coe_app.montar_conteudo(Inventadas(), AGORA), default=str))
VAPID = "BEXEMPLO-chave-publica-inventada"
pacote = coe_app.montar_pacote(conteudo, [pessoa], VAPID)
# prova de uma inscrição inventada, calculada pelo MAPI: o app tem que chegar no mesmo valor
insc = {"endpoint": "https://fcm.googleapis.com/fcm/send/exemplo", "p256dh": "B" + "x" * 86, "auth": "y" * 22}
saida = {"hub": {"matricula": MAT, "chave": CHAVE, "salt": base64.b64encode(salt).decode(), "iter": hub.ITERACOES},
         "pacote": pacote, "esperado": conteudo,
         "push": {"chave": VAPID, "segredo": base64.b64encode(segredo).decode(), "inscricao": insc,
                  "mac": coe_app.mac_inscricao(segredo, insc["endpoint"], insc["p256dh"], insc["auth"])}}
destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "pacote.json")
with open(destino, "w", encoding="utf-8") as f:
    json.dump(saida, f, ensure_ascii=False, indent=1)
print("gravado:", destino)
