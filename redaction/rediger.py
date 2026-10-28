#!/usr/bin/env python3
"""Rédacteur du guetteur : lancé par GitHub Actions quand le guetteur Cloudflare repère un post chaud.

1. relit le post via FxTwitter (gratuit, sans compte) ;
2. demande 2 réponses à Claude (ton abonnement, via `claude -p`) avec le guide et le vécu d'Adem ;
3. passe le contrôle (`controle_reponses.py`), réécrit une fois si une réponse est KO ;
4. renvoie les brouillons au guetteur, qui les envoie sur Telegram.

Usage : rediger.py <post_id> <alert_id>   (variables : WORKER_URL, WORKER_KEY)
         rediger.py <post_id> 0 --sec     (essai local : affiche sans rien envoyer)
"""
import json, os, re, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path

ICI = Path(__file__).resolve().parent
RACINE = ICI.parent
CTX = RACINE / "contexte"
sys.path.insert(0, str(CTX))
from controle_reponses import controle  # noqa: E402

UA = {"User-Agent": "guetteur-ademmbnn/1.0"}


def get_json(url, headers=None, essais=3):
    for i in range(essais):
        try:
            req = urllib.request.Request(url, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # FxTwitter renvoie parfois 404 par intermittence
            if i == essais - 1:
                raise
            time.sleep(2)


def post_json(url, data, key):
    req = urllib.request.Request(url, data=json.dumps(data).encode(), method="POST",
                                 headers={**UA, "Content-Type": "application/json", "X-Key": key})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode()


def lire(nom, debut=None, fin=None):
    t = (CTX / nom).read_text(encoding="utf-8")
    if debut:
        i = t.find(debut)
        t = t[i:] if i >= 0 else t
    if fin:
        j = t.find(fin, 1)
        t = t[:j] if j > 0 else t
    return t


def contexte_guide():
    g = (CTX / "guide-redaction.md").read_text(encoding="utf-8")
    # On garde §0, §0 bis, §0 ter et §5 (le reste parle des posts).
    parts = []
    for debut, fin in (("## 0. ", "## 1."), ("## 5. ", "## 6.")):
        i = g.find(debut)
        if i >= 0:
            j = g.find(fin, i)
            parts.append(g[i:j if j > 0 else None])
    return "\n".join(parts)


def construire_prompt(post, recent, retour=None):
    vecu = "\n\n".join(p.read_text(encoding="utf-8") for p in sorted((CTX / "vecu").glob("*.md")))
    voix = (CTX / "adem-posts.md").read_text(encoding="utf-8")
    a = post["author"]
    p = f"""Tu rédiges des réponses X pour Adem (@ademmbnn), étudiant en M1 à l'ESSEC qui build avec l'IA. Il les relit et les publie lui-même.

# Le post auquel répondre
Auteur : @{a.get('screen_name')} ({a.get('followers')} abonnés). Publié il y a {post['_age_min']} min, {post.get('views')} vues, {post.get('likes')} likes, {post.get('replies')} réponses.
Texte :
<<<
{post.get('text')}
>>>

# Ce qu'il faut écrire
Deux réactions différentes, comme un pote qui scrolle et tape en 10 secondes sur son téléphone. Une seule phrase chacune, souvent 40 à 120 caractères, minuscules.
- On réagit AU POST : surprise (« attends il a inventé des faux mails ?? »), petite vanne, avis franc, ou une question toute bête (« à partir de combien c'est gagner sa vie ? »).
- On ne ramène PAS tout à Adem. Pas de vécu, sauf si le post pose une question dont un fait de la section « Vécu » est la réponse évidente.
- Interdit : expliquer, faire la leçon, reformuler le post, mettre deux idées, « c'est pour ça que », « le pire c'est que », « tu crois qu'on pourra un jour », « d'après », « c'est pile ce que », « en soi », « X c'est pas le souci, c'est Y ».
Règles strictes :
- AUCUN faux vécu : n'invente jamais un projet, un chiffre, un client, un outil utilisé ou une expérience.
- Rien sur Mate, Major Prépa, Square Management.
- Pas de lien, pas de hashtag, pas d'emoji, pas de tiret cadratin, pas de @ au début.
- Au plus une question, jamais à deux branches (« A ou B ? »). Jamais de compliment vide.
- Les deux réponses ne commencent pas par les mêmes mots, ni par les mêmes mots que ces réponses récentes d'Adem : {json.dumps(recent[:8], ensure_ascii=False)}
- Ton : les vrais textes d'Adem ci-dessous. « ya », « en vrai », « mdr », « att », « je capte pas » si ça sonne naturel.

# Guide de rédaction (extraits)
{contexte_guide()}

# Vrais textes d'Adem (sa voix ; ne pas les recopier)
{voix}

# Vécu (les seuls faits vrais qu'Adem peut citer)
{vecu}
"""
    if retour:
        p += f"\n# Correction demandée\nTon essai précédent a échoué au contrôle :\n{retour}\nRéécris les deux réponses de zéro en corrigeant ces points.\n"
    p += '\n# Format de sortie\nRéponds UNIQUEMENT avec un objet JSON, sans texte autour : {"replies": ["réponse 1", "réponse 2"], "pourquoi": "une phrase sur l\'angle choisi"}\n'
    return p


def appeler_claude(prompt):
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".txt", encoding="utf-8") as f:
        f.write(prompt)
        chemin = f.name
    cmd = ["claude", "-p", "--model", os.environ.get("MODELE", "sonnet"), "--output-format", "text",
           "--max-turns", "1", "--disallowedTools", "Bash,Edit,Write,Read,WebFetch,WebSearch,Glob,Grep,Task",
           "--system-prompt", "Tu es un rédacteur. Tu réponds uniquement avec l'objet JSON demandé."]
    with open(chemin, encoding="utf-8") as entree:
        r = subprocess.run(cmd, stdin=entree, capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        raise RuntimeError(f"claude -p a échoué : {r.stderr[-500:]}")
    m = re.search(r"\{.*\}", r.stdout, re.S)
    if not m:
        raise RuntimeError(f"pas de JSON dans la réponse : {r.stdout[:300]}")
    return json.loads(m.group(0))


def verifier(replies, post_text, recent):
    res = []
    for i, rep in enumerate(replies):
        pb, av = controle(rep, post_text, recent, [x for j, x in enumerate(replies) if j != i])
        res.append({"ok": not pb, "problemes": pb, "avertissements": av})
    return res


def main():
    post_id, alert_id = sys.argv[1], int(sys.argv[2])
    sec = "--sec" in sys.argv
    wurl, wkey = os.environ.get("WORKER_URL", ""), os.environ.get("WORKER_KEY", "")
    t0 = time.time()
    d = get_json(f"https://api.fxtwitter.com/2/status/{post_id}")
    post = d.get("status") or d.get("tweet") or d
    post["_age_min"] = round((time.time() - post.get("created_timestamp", time.time())) / 60)
    recent = []
    if wurl and not sec:
        try:
            recent = get_json(f"{wurl}/recent", {"X-Key": wkey}).get("textes", [])
        except Exception:
            pass
    retour, replies, res, pourquoi, essais = None, [], [], "", 0
    for essais in (1, 2):
        out = appeler_claude(construire_prompt(post, recent, retour))
        replies = [r.strip() for r in out.get("replies", [])][:2]
        pourquoi = out.get("pourquoi", "")
        res = verifier(replies, post.get("text", ""), recent)
        if all(x["ok"] for x in res):
            break
        retour = "\n".join(f"- réponse {i+1} : {' ; '.join(x['problemes'])}" for i, x in enumerate(res) if not x["ok"])
    # On n'envoie que les réponses qui passent le contrôle (au moins une, sinon on envoie le post seul).
    gardees = [r for r, x in zip(replies, res) if x["ok"]]
    paquet = {"alert_id": alert_id, "post_id": post_id, "replies": gardees, "pourquoi": pourquoi,
              "controle": res, "essais": essais, "duree_s": round(time.time() - t0)}
    print(json.dumps(paquet, ensure_ascii=False, indent=1))
    if not sec:
        print(post_json(f"{wurl}/drafts", paquet, wkey))


if __name__ == "__main__":
    main()
