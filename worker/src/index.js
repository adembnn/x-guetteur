// Guetteur X d'Adem (@ademmbnn). Tourne chaque minute sur Cloudflare (offre gratuite).
// 1. Regarde un lot de comptes cibles via FxTwitter (gratuit, sans compte X).
// 2. Repère les posts en français de moins de 15 min qui démarrent.
// 3. Réveille le rédacteur (GitHub Actions) qui écrit 2 réponses avec l'abonnement Claude d'Adem.
// 4. Envoie le post et les brouillons sur Telegram, avec un bouton qui ouvre X pré-rempli. Adem publie lui-même.
// 5. Relève les vues des réponses publiées à 24 h.
// Ne publie jamais rien sur X et ne se connecte jamais au compte d'Adem.

const FX = "https://api.fxtwitter.com";
const UA = { "User-Agent": "guetteur-ademmbnn/1.0 (+usage perso, 1 req/5 s par compte)" };
const MIN = 60_000;

// ---------- petits outils ----------
const now = () => Date.now();
const heureParis = (t = now()) =>
  Number(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "numeric", hour12: false }).format(t));
const jourParis = (t = now()) =>
  new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(t); // AAAA-MM-JJ
const debutJour = (t = now()) => {
  // minuit, heure de Paris, en millisecondes
  const [h, m, s] = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    .format(t).split(":").map(Number);
  return t - ((h % 24) * 3600 + m * 60 + s) * 1000 - (t % 1000);
};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const k = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",") + " k" : String(n ?? 0));

async function getCfg(env, cle, defaut = null) {
  const r = await env.DB.prepare("SELECT v FROM config WHERE k=?").bind(cle).first();
  return r ? r.v : defaut;
}
const setCfg = (env, cle, v) => env.DB.prepare("INSERT INTO config(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(cle, String(v)).run();

async function fx(chemin) {
  const r = await fetch(FX + chemin, { headers: UA });
  if (!r.ok) return null;
  const d = await r.json();
  return d && (d.code === 200 || d.status || d.results) ? d : null;
}

async function tg(env, methode, corps) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${methode}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps),
  });
  return r.json();
}
async function dire(env, texte, extra = {}) {
  const chat = await getCfg(env, "chat_id");
  if (!chat) return null;
  const r = await tg(env, "sendMessage", { chat_id: chat, text: texte, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  if (!r?.ok) await setCfg(env, "derniere_erreur_tg", JSON.stringify(r).slice(0, 300));
  return r;
}

// ---------- 1-3. la ronde ----------
// « Démarre » : moins de 15 min, et déjà de l'élan. Seuils de départ, réglés ensuite par la rétro avec la table `vus`.
const THEME = /\b(ia|ai|gpt|chatgpt|claude|gemini|grok|mistral|llm|agents?|agentique|openai|anthropic|google|apple|meta|nvidia|code|coder|codeur|dev|développeur|saas|app|startup|no-?code|n8n|cursor|automatis\w*|prompt|modèles?|api|bot|tech|build|produit|mvp|hackathon|vibe|seo|data|robot\w*|fable|astra|genie|carbon|macbook|iphone|logiciel|outil\w*)\b/i;
function estChaud(p, ageMin, followers) {
  if (ageMin > 15 || followers < 300 || !THEME.test(p.text || "")) return false;
  const vues = p.views || 0, likes = p.likes || 0, rep = p.replies || 0;
  const vitesse = vues / Math.max(ageMin, 1);
  return (vitesse >= 15 && vues >= 40) || likes >= 3 || rep >= 2;
}

async function ronde(env) {
  // Chaque compte a sa prochaine visite : 3 min s'il poste beaucoup, 4 min moyen, 6 min au plus.
  const lot = Number(env.LOT || 40);
  const t0 = now();
  const dus = (await env.DB.prepare("SELECT handle, posts_jour FROM cibles WHERE actif=1 AND COALESCE(prochain,0) <= ? ORDER BY COALESCE(prochain,0) LIMIT ?").bind(t0, lot).all()).results;
  if (!dus.length) return { regardes: 0 };
  const pas = (pj) => (pj >= 2 ? 3 : pj >= 0.7 ? 4 : 6) * MIN;
  // On « réserve » les comptes avant de les lire, pour que deux rondes en parallèle ne lisent pas les mêmes.
  await env.DB.batch(dus.map((c) => env.DB.prepare("UPDATE cibles SET prochain=? WHERE handle=?").bind(t0 + pas(c.posts_jour || 0) + Math.floor(Math.random() * 20000), c.handle)));
  const choix = dus.map((c) => c.handle);

  const reponses = await Promise.all(choix.map((h) => fx(`/2/profile/${h}/statuses?count=3`).catch(() => null)));
  const chauds = [];
  const ecritures = [];
  for (const d of reponses) {
    for (const p of d?.results || []) {
      if (p.reposted_by || p.replying_to || p.lang !== "fr") continue;
      const age = (now() - p.created_timestamp * 1000) / MIN;
      if (age < 0 || age > 20) continue;
      const followers = p.author?.followers || 0;
      const chaud = estChaud(p, age, followers);
      ecritures.push(env.DB.prepare(
        "INSERT INTO vus(id,handle,created,vu_a,age_min,views,likes,replies,followers,chaud) VALUES(?,?,?,?,?,?,?,?,?,?) " +
        "ON CONFLICT(id) DO UPDATE SET vu_a=excluded.vu_a, age_min=excluded.age_min, views=excluded.views, likes=excluded.likes, replies=excluded.replies, chaud=MAX(chaud, excluded.chaud)"
      ).bind(p.id, p.author?.screen_name, p.created_timestamp * 1000, now(), Math.round(age * 10) / 10, p.views || 0, p.likes || 0, p.replies || 0, followers, chaud ? 1 : 0));
      if (chaud) chauds.push({ p, age });
    }
  }
  if (ecritures.length) await env.DB.batch(ecritures);
  for (const c of chauds) await alerter(env, c.p, c.age);
  return { regardes: choix.length, frais: ecritures.length, chauds: chauds.length };
}

async function alerter(env, p, age) {
  const deja = await env.DB.prepare("SELECT 1 FROM alertes WHERE post_id=?").bind(p.id).first();
  if (deja) return;
  const jour = debutJour();
  const { n: nAlertes } = await env.DB.prepare("SELECT COUNT(*) n FROM alertes WHERE cree_a>=?").bind(jour).first();
  const { n: nPostees } = await env.DB.prepare("SELECT COUNT(*) n FROM alertes WHERE poste_a>=?").bind(jour).first();
  if (nAlertes >= Number(env.MAX_ALERTES || 30) || nPostees >= Number(env.MAX_POSTEES || 25)) return;
  // Pas deux alertes sur le même auteur en 3 h (on ne veut pas lui coller aux basques).
  const auteur = p.author?.screen_name;
  const recent = await env.DB.prepare("SELECT 1 FROM alertes WHERE handle=? AND cree_a>=?").bind(auteur, now() - 180 * MIN).first();
  if (recent) return;
  const r = await env.DB.prepare(
    "INSERT INTO alertes(post_id,handle,followers,texte_post,post_created,age_min,views,likes,replies,cree_a,statut) VALUES(?,?,?,?,?,?,?,?,?,?, 'redaction') RETURNING id"
  ).bind(p.id, auteur, p.author?.followers || 0, (p.text || "").slice(0, 1000), p.created_timestamp * 1000, Math.round(age), p.views || 0, p.likes || 0, p.replies || 0, now()).first();
  const ok = await lancerRedaction(env, p.id, r.id);
  if (!ok) await envoyerAlerte(env, r.id, [], "rédacteur injoignable, voici le post seul");
}

async function lancerRedaction(env, postId, alertId) {
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/rediger.yml/dispatches`, {
    method: "POST",
    headers: { ...UA, Accept: "application/vnd.github+json", Authorization: `Bearer ${env.GH_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { post_id: String(postId), alert_id: String(alertId) } }),
  });
  if (r.status !== 204) await setCfg(env, "derniere_erreur_gh", `${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.status === 204;
}

// ---------- 4. Telegram ----------
async function envoyerAlerte(env, alertId, replies, note = "") {
  const a = await env.DB.prepare("SELECT * FROM alertes WHERE id=?").bind(alertId).first();
  if (!a) return;
  const age = Math.round((now() - a.post_created) / MIN);
  const lien = `https://x.com/${a.handle}/status/${a.post_id}`;
  let t = `<b>@${esc(a.handle)}</b> · ${age} min · ${k(a.views)} vues · ${k(a.followers)} abonnés\n`;
  t += `<i>${esc((a.texte_post || "").slice(0, 280))}</i>\n`;
  if (note) t += `\n⚠️ ${esc(note)}\n`;
  replies.forEach((r, i) => { t += `\n<b>${i + 1}.</b> ${esc(r)}\n<code>${r.length} car.</code>\n`; });
  const boutons = replies.map((r, i) => [{ text: `Répondre ${i + 1}`, url: `https://x.com/intent/post?in_reply_to=${a.post_id}&text=${encodeURIComponent(r)}` }]);
  boutons.push([{ text: "Ouvrir le post", url: lien }]);
  boutons.push([
    ...replies.map((_, i) => ({ text: `✅ posté ${i + 1}`, callback_data: `ok:${a.id}:${i + 1}` })),
    { text: "✅ posté (perso)", callback_data: `ok:${a.id}:0` },
    { text: "Passer", callback_data: `p:${a.id}` },
  ]);
  const m = await dire(env, t, { reply_markup: { inline_keyboard: boutons } });
  await env.DB.prepare("UPDATE alertes SET statut='envoyee', envoye_a=?, brouillons=?, tg_msg=? WHERE id=?")
    .bind(now(), JSON.stringify(replies), m?.result?.message_id || null, a.id).run();
}

async function telegram(env, u) {
  const chat = await getCfg(env, "chat_id");
  const msg = u.message, cb = u.callback_query;
  const from = String((msg || cb?.message)?.chat?.id || "");
  if (msg?.text?.startsWith("/start") && !chat) {
    await setCfg(env, "chat_id", from);
    await dire(env, "C'est branché. Je t'envoie ici les posts chauds avec 2 réponses prêtes.\n/stop pour mettre en pause, /go pour reprendre, /etat pour le bilan du jour.");
    return;
  }
  if (!chat || from !== chat) return; // on n'écoute que le chat d'Adem
  if (cb) {
    const [type, id, n] = cb.data.split(":");
    if (type === "ok") {
      await env.DB.prepare("UPDATE alertes SET statut='postee', brouillon_choisi=?, poste_a=? WHERE id=?").bind(Number(n), now(), Number(id)).run();
      await tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text: "Noté. Si tu as modifié le texte, colle-moi le lien de ta réponse." });
    } else if (type === "p") {
      await env.DB.prepare("UPDATE alertes SET statut='passee' WHERE id=?").bind(Number(id)).run();
      await tg(env, "answerCallbackQuery", { callback_query_id: cb.id, text: "Passé." });
    }
    return;
  }
  const t = msg?.text || "";
  if (t.startsWith("/stop")) { await setCfg(env, "pause", 1); await dire(env, "Pause. Plus aucune alerte jusqu'à /go."); return; }
  if (t.startsWith("/go")) { await setCfg(env, "pause", 0); await dire(env, "C'est reparti."); return; }
  if (t.startsWith("/etat")) { await dire(env, await bilan(env)); return; }
  const m = t.match(/(?:x|twitter)\.com\/(\w+)\/status\/(\d+)/);
  if (m) {
    // Adem colle le lien de sa réponse : on la rattache à la dernière alerte postée sans lien.
    const a = await env.DB.prepare("SELECT id FROM alertes WHERE statut IN ('postee','envoyee') AND reply_id IS NULL ORDER BY cree_a DESC LIMIT 1").first();
    if (a) {
      await env.DB.prepare("UPDATE alertes SET reply_id=?, statut='postee', poste_a=COALESCE(poste_a, ?) WHERE id=?").bind(m[2], now(), a.id).run();
      await dire(env, "Lien rattaché, je relève ses vues dans 24 h.");
    }
  }
}

async function bilan(env) {
  const j = debutJour();
  const q = (sql) => env.DB.prepare(sql).bind(j).first();
  const al = await q("SELECT COUNT(*) n FROM alertes WHERE cree_a>=?");
  const po = await q("SELECT COUNT(*) n FROM alertes WHERE poste_a>=?");
  const fr = await q("SELECT COUNT(*) n FROM vus WHERE vu_a>=?");
  const pause = (await getCfg(env, "pause", "0")) === "1";
  const dern = await env.DB.prepare("SELECT AVG(vues_24h) m, COUNT(*) n FROM alertes WHERE vues_24h IS NOT NULL AND poste_a>=?").bind(now() - 7 * 24 * 60 * MIN).first();
  return `Aujourd'hui : ${al.n} alertes, ${po.n} réponses postées, ${fr.n} posts frais vus.${pause ? " En PAUSE." : ""}\n7 derniers jours : ${dern.n} réponses relevées, ${Math.round(dern.m || 0)} vues en moyenne à 24 h.`;
}

// ---------- 5. relevé des réponses ----------
async function trouverReponseAdem(env, postId) {
  const d = await fx(`/2/conversation/${postId}`);
  const r = (d?.replies || []).find((x) => x.author?.screen_name?.toLowerCase() === env.ADEM.toLowerCase());
  return r || null;
}

async function releves(env) {
  // a) chercher la réponse d'Adem 20 min à 3 h après l'alerte (si le bouton n'a pas donné de lien)
  const aTrouver = (await env.DB.prepare(
    "SELECT id, post_id, statut FROM alertes WHERE reply_id IS NULL AND statut IN ('envoyee','postee') AND cree_a < ? AND cree_a > ? AND COALESCE(releve_a,0) < ? ORDER BY cree_a LIMIT 1"
  ).bind(now() - 20 * MIN, now() - 180 * MIN, now() - 20 * MIN).all()).results;
  for (const a of aTrouver) {
    const r = await trouverReponseAdem(env, a.post_id);
    if (r) await env.DB.prepare("UPDATE alertes SET reply_id=?, reply_texte=?, statut='postee', poste_a=COALESCE(poste_a, ?), releve_a=? WHERE id=?").bind(r.id, r.text, r.created_timestamp * 1000, now(), a.id).run();
    else await env.DB.prepare("UPDATE alertes SET releve_a=?, essais_releve=essais_releve+1 WHERE id=?").bind(now(), a.id).run();
  }
  // b) alertes jamais postées après 3 h
  await env.DB.prepare("UPDATE alertes SET statut='non_postee' WHERE statut='envoyee' AND reply_id IS NULL AND cree_a < ?").bind(now() - 180 * MIN).run();
  // c) vues à 24 h
  const aMesurer = (await env.DB.prepare(
    "SELECT id, post_id, reply_id, handle FROM alertes WHERE statut='postee' AND vues_24h IS NULL AND poste_a < ? AND COALESCE(releve_a,0) < ? LIMIT 1"
  ).bind(now() - 24 * 60 * MIN, now() - 60 * MIN).all()).results;
  for (const a of aMesurer) {
    let rep = null;
    if (a.reply_id) rep = (await fx(`/2/status/${a.reply_id}`))?.status || null;
    if (!rep) rep = await trouverReponseAdem(env, a.post_id);
    if (!rep) {
      await env.DB.prepare("UPDATE alertes SET releve_a=?, essais_releve=essais_releve+1, vues_24h=CASE WHEN essais_releve>=4 THEN -1 ELSE NULL END WHERE id=?").bind(now(), a.id).run();
      continue;
    }
    const conv = await fx(`/2/conversation/${rep.id}`);
    const auteur = (conv?.replies || []).some((x) => x.author?.screen_name?.toLowerCase() === a.handle.toLowerCase()) ? 1 : 0;
    await env.DB.prepare("UPDATE alertes SET reply_id=?, reply_texte=COALESCE(reply_texte, ?), vues_24h=?, likes_24h=?, reponses_24h=?, auteur_a_repondu=?, releve_a=? WHERE id=?")
      .bind(rep.id, rep.text, rep.views || 0, rep.likes || 0, rep.replies || 0, auteur, now(), a.id).run();
  }
}

// ---------- API pour le rédacteur et le Mac ----------
const COLS = ["id", "post_id", "handle", "followers", "age_min", "views", "likes", "replies", "cree_a", "envoye_a", "statut", "brouillon_choisi", "poste_a", "reply_id", "reply_texte", "vues_24h", "likes_24h", "reponses_24h", "auteur_a_repondu", "brouillons", "pourquoi", "texte_post"];
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const iso = (t) => (t ? new Date(t).toISOString() : "");

async function api(req, env) {
  const url = new URL(req.url);
  if (url.pathname === "/telegram") {
    if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_SECRET) return new Response("non", { status: 403 });
    await telegram(env, await req.json());
    return new Response("ok");
  }
  if (req.headers.get("X-Key") !== env.WORKER_KEY) return new Response("non", { status: 403 });
  if (url.pathname === "/drafts" && req.method === "POST") {
    const d = await req.json();
    await env.DB.prepare("UPDATE alertes SET pourquoi=? WHERE id=?").bind(d.pourquoi || d.erreur || "", Number(d.alert_id)).run();
    await envoyerAlerte(env, Number(d.alert_id), d.replies || [], d.erreur || (d.replies?.length ? "" : "aucun brouillon n'a passé le contrôle"));
    return Response.json({ ok: true });
  }
  if (url.pathname === "/recent") {
    const r = (await env.DB.prepare("SELECT reply_texte, brouillons FROM alertes WHERE cree_a > ? ORDER BY cree_a DESC LIMIT 10").bind(now() - 6 * 60 * MIN).all()).results;
    const textes = r.flatMap((x) => (x.reply_texte ? [x.reply_texte] : JSON.parse(x.brouillons || "[]")));
    return Response.json({ textes });
  }
  if (url.pathname === "/export.csv") {
    const r = (await env.DB.prepare("SELECT * FROM alertes ORDER BY cree_a").all()).results;
    const lignes = [COLS.join(",")].concat(r.map((a) => COLS.map((c) => csvCell(["cree_a", "envoye_a", "poste_a"].includes(c) ? iso(a[c]) : a[c])).join(",")));
    return new Response(lignes.join("\n") + "\n", { headers: { "Content-Type": "text/csv; charset=utf-8" } });
  }
  if (url.pathname === "/vus.csv") {
    const r = (await env.DB.prepare("SELECT * FROM vus WHERE vu_a > ? ORDER BY vu_a").bind(now() - 7 * 24 * 60 * MIN).all()).results;
    const c = ["id", "handle", "created", "vu_a", "age_min", "views", "likes", "replies", "followers", "chaud"];
    return new Response([c.join(",")].concat(r.map((x) => c.map((k) => csvCell(x[k])).join(","))).join("\n") + "\n", { headers: { "Content-Type": "text/csv; charset=utf-8" } });
  }
  if (url.pathname === "/pause" && req.method === "POST") {
    const d = await req.json();
    await setCfg(env, "pause", d.pause ? 1 : 0);
    if (d.pause) await dire(env, `Pause automatique : ${esc(d.raison || "disjoncteur")}.`);
    return Response.json({ ok: true, pause: !!d.pause });
  }
  if (url.pathname === "/cibles" && req.method === "POST") {
    const liste = await req.json();
    const st = [env.DB.prepare("UPDATE cibles SET actif=0")].concat(liste.map((c) =>
      env.DB.prepare("INSERT INTO cibles(handle,priorite,actif,posts_jour) VALUES(?,?,1,?) ON CONFLICT(handle) DO UPDATE SET priorite=excluded.priorite, posts_jour=excluded.posts_jour, actif=1").bind(c.handle, c.priorite || 2, c.posts_jour || 0)));
    await env.DB.batch(st);
    return Response.json({ ok: true, n: liste.length });
  }
  if (url.pathname === "/ronde" && req.method === "POST") return Response.json(await ronde(env)); // essai manuel
  if (url.pathname === "/essai" && req.method === "POST") {
    // Essai de bout en bout sur un post choisi, même hors des heures et des seuils.
    const { post_id } = await req.json();
    const d = await fx(`/2/status/${post_id}`);
    const p = d?.status;
    if (!p) return Response.json({ ok: false, raison: "post introuvable" });
    await env.DB.prepare("DELETE FROM alertes WHERE post_id=? AND statut IN ('redaction','envoyee')").bind(p.id).run();
    const r = await env.DB.prepare(
      "INSERT INTO alertes(post_id,handle,followers,texte_post,post_created,age_min,views,likes,replies,cree_a,statut) VALUES(?,?,?,?,?,?,?,?,?,?, 'redaction') RETURNING id"
    ).bind(p.id, p.author?.screen_name, p.author?.followers || 0, (p.text || "").slice(0, 1000), p.created_timestamp * 1000, Math.round((now() - p.created_timestamp * 1000) / MIN), p.views || 0, p.likes || 0, p.replies || 0, now()).first();
    return Response.json({ ok: await lancerRedaction(env, p.id, r.id), alert_id: r.id });
  }
  if (url.pathname === "/bilan") return new Response(await bilan(env));
  if (url.pathname === "/sante") return Response.json({ chat: !!(await getCfg(env, "chat_id")), pause: await getCfg(env, "pause", "0"), erreur_gh: await getCfg(env, "derniere_erreur_gh"), erreur_tg: await getCfg(env, "derniere_erreur_tg"), cibles: (await env.DB.prepare("SELECT COUNT(*) n FROM cibles WHERE actif=1").first()).n, retard_max_min: Math.round(((now() - ((await env.DB.prepare("SELECT MIN(COALESCE(prochain,0)) m FROM cibles WHERE actif=1").first()).m || now())) / MIN) * 10) / 10 });
  return new Response("guetteur-x", { status: 200 });
}

export default {
  fetch: (req, env) => api(req, env),
  async scheduled(_evt, env, ctx) {
    const h = heureParis();
    const pause = (await getCfg(env, "pause", "0")) === "1";
    if (!pause && h >= Number(env.HEURE_DEBUT || 8) && h < Number(env.HEURE_FIN || 22)) ctx.waitUntil(ronde(env));
    ctx.waitUntil(releves(env));
  },
};
