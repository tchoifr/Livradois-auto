/*
 * Tests de bout en bout de l'API du back-office (critères d'acceptation, section 12 de la spécification).
 * Usage :
 *   API=http://127.0.0.1:8766/api.php ADMIN_EMAIL=… ADMIN_PASSWORD=… BO_DIR=backoffice \
 *   PHP_BIN=php [MAIL_LOG=/tmp/mails.log] [CRON_KEY=…] node tests/api.test.mjs
 * La base doit contenir le compte administrateur et les annonces d'exemple (setup.php --demo).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const API = process.env.API;
const PHP = (process.env.PHP_BIN || "php").split(" ");
const MAIL_LOG = process.env.MAIL_LOG || "";
let failures = 0, passes = 0;
const ok = (cond, label, detail) => {
  if (cond) { passes++; console.log("  ✔ " + label); }
  else { failures++; console.log("  ✘ " + label + (detail !== undefined ? " → " + JSON.stringify(detail).slice(0, 400) : "")); }
};
const section = (t) => console.log("\n" + t);

async function call(route, { token, method, body, query, form, demo, raw, headers } = {}) {
  const qs = new URLSearchParams({ ...(demo ? { demo: "1" } : {}), r: route, ...(query || {}) });
  const init = { method: method || (body || form ? "POST" : "GET"), headers: { ...(headers || {}) } };
  if (token) init.headers["X-LA-Token"] = token;
  if (body) { init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
  if (form) init.body = form;
  const res = await fetch(API + "?" + qs.toString(), init);
  if (raw) return res;
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}
const login = async (email, password) => (await call("auth/login", { body: { email, password } })).data?.token;
const day = (offset, time) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10) + " " + time;
};
const fixture = (...args) => JSON.parse(execFileSync(PHP[0], [...PHP.slice(1), "tests/fixture.php", ...args.map(String)], { env: { ...process.env } }).toString());
const uniq = Date.now().toString(36);

// ---------------------------------------------------------------------------------------------
section("0. Connexion et compatibilité du site public");
const A = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
ok(!!A, "connexion administrateur");
const pub = await call("vehicules");
ok(pub.status === 200 && Array.isArray(pub.data) && pub.data.length > 0, "GET vehicules public : " + (pub.data || []).length + " annonces");
const expectedKeys = ["id", "ref", "statut", "marque", "modele", "version", "annee", "miseEnCirculation", "km", "energie", "boite", "carrosserie", "puissance", "cv", "portes", "places", "couleur", "critair", "premiereMain", "quatreRoues", "garantie", "prix", "prixBarre", "badge", "ajoutLe", "photos", "equipements", "description"];
const keys = Object.keys(pub.data[0]).filter((k) => k !== "autonomie");
ok(expectedKeys.every((k) => keys.includes(k)) && keys.every((k) => expectedKeys.includes(k)), "format public inchangé (aucun champ interne exposé)", keys);
ok(pub.data.every((v) => ["disponible", "reserve"].includes(v.statut)), "seules les annonces en ligne/réservées sont publiques");
ok((await call("admin/reparations", { token: A })).status === 404 && (await call("admin/ordre-reparation", { token: A, body: {} })).status === 404, "aucun module de réparation n'existe");
ok((await call("admin/vehicules")).status === 401, "routes privées refusées sans jeton");

// ---------------------------------------------------------------------------------------------
section("1. Parcs, comptes et affectations");
const nord = (await call("admin/parc", { token: A, body: { code: "NOR" + uniq.slice(-3), nom: "Parc Nord " + uniq, adresse: "1 rue du Nord" } })).data;
const sud = (await call("admin/parc", { token: A, body: { code: "SUD" + uniq.slice(-3), nom: "Parc Sud " + uniq, adresse: "1 rue du Sud" } })).data;
ok(nord?.id && sud?.id, "création de deux parcs");
const pwd = "MotDePasseTest-2026!";
const mkUser = async (email, role, parcs) => (await call("admin/utilisateur", { token: A, body: { email, name: email.split("@")[0], role, password: pwd, parcs } })).data;
const secN = await mkUser(`sec.nord.${uniq}@test.local`, "secretaire", [nord.id]);
const secS = await mkUser(`sec.sud.${uniq}@test.local`, "secretaire", [sud.id]);
const refN = await mkUser(`ref.nord.${uniq}@test.local`, "referent", [nord.id]);
ok(secN?.id && secS?.id && refN?.id && secN.parcs.length === 1, "comptes secrétaire/référente créés et affectés");
const SN = await login(`sec.nord.${uniq}@test.local`, pwd);
const SS = await login(`sec.sud.${uniq}@test.local`, pwd);
const RN = await login(`ref.nord.${uniq}@test.local`, pwd);
ok(!!SN && !!SS && !!RN, "connexion des comptes nominatifs");
const me = (await call("auth/me", { token: SN })).data.user;
ok(me.role === "secretaire" && Array.isArray(me.parcs) && me.parcs.includes(nord.id), "profil secrétaire : rôle et parcs renvoyés", me);

const mkVeh = async (token, parcId, marque, modele, extra = {}) => (await call("admin/vehicule", { token, body: { marque, modele, version: "Test", annee: 2020, km: 50000, prix: 12500, parcId, statut: "disponible", energie: "Essence", boite: "Manuelle", carrosserie: "Citadine", ...extra } }));
const v1 = (await mkVeh(A, nord.id, "Peugeot", "208", { immatriculation: "ab 123 cd", numeroStock: "TST-" + uniq + "-1" })).data;
const v2 = (await mkVeh(A, nord.id, "Renault", "Clio")).data;
const v3 = (await mkVeh(A, sud.id, "Dacia", "Duster")).data;
ok(v1?.dbId && v2?.dbId && v3?.dbId, "trois véhicules créés (2 au Nord, 1 au Sud)");
ok(v1.immatriculation === "AB-123-CD" && v1.numeroStock === "TST-" + uniq.toUpperCase() + "-1", "immatriculation normalisée, numéro de stock enregistré", { i: v1.immatriculation, s: v1.numeroStock });
ok((await mkVeh(A, nord.id, "Fiat", "500", { numeroStock: v1.numeroStock })).status === 422, "numéro de stock unique");
ok((await mkVeh(SN, nord.id, "Fiat", "500")).status === 403, "une secrétaire ne peut pas créer d'annonce");
const vRef = await mkVeh(RN, nord.id, "Fiat", "Panda");
ok(vRef.status === 200, "la référente du parc peut créer une annonce dans son parc");
ok((await mkVeh(RN, sud.id, "Fiat", "Tipo")).status === 403, "…mais pas dans un parc qui n'est pas le sien");

section("2. Cloisonnement par parc (Nord ≠ Sud)");
ok((await call("admin/vehicule", { token: SN, query: { id: v3.dbId } })).status === 403, "secrétaire Nord : véhicule du Sud refusé (403)");
const listN = (await call("admin/vehicules", { token: SN })).data.map((v) => v.dbId);
ok(listN.includes(v1.dbId) && !listN.includes(v3.dbId), "secrétaire Nord : la liste ne contient que ses parcs");
ok((await call("admin/vehicule/checklist", { token: SN, body: { vehiculeId: v3.dbId, itemId: 1, statut: "termine" } })).status === 403, "secrétaire Nord : préparation d'un véhicule du Sud refusée");
for (const [r, label] of [["admin/finance/vehicule", "finances"], ["admin/parametres", "paramètres"], ["admin/audit", "journal"], ["admin/utilisateurs", "comptes"], ["admin/rapports", "rapports"]]) {
  ok((await call(r, { token: SN, query: { id: v1.dbId } })).status === 403, `secrétaire : accès aux ${label} refusé`);
}

// ---------------------------------------------------------------------------------------------
section("3. Rendez-vous par téléphone et doubles réservations");
await call("admin/parametres", { token: A, body: { rappels: { actifs: true, h24: true, h2: true } } });
const d3 = day(3, "10:00");
let res = await call("admin/rendez-vous", { token: SN, body: { vehiculeId: v1.dbId, motif: "visite", debut: d3, nouveauClient: { prenom: "Jean", nom: "Test" + uniq, telephone: "06 12 34 " + String(Date.now()).slice(-4, -2) + " " + String(Date.now()).slice(-2), email: `jean.${uniq}@client.test`, serviceEmail: true } } });
ok(res.status === 200, "création d'un rendez-vous avec fiche client minimale", res.data);
const R1 = res.data?.rendezVous;
ok(R1 && R1.fin.slice(11, 16) === "10:30", "durée par défaut du motif appliquée (30 min)", R1 && R1.fin);
ok(res.data?.proposition?.possible === true && res.data.proposition.canal === "email" && res.data.proposition.texte.includes("Test" + uniq) === false && res.data.proposition.texte.includes("Jean"), "aperçu de confirmation proposé (destinataire, canal, texte)", res.data?.proposition);
const client = (await call("admin/client", { token: SN, query: { id: R1.clientId } })).data;
ok(client.rendezVous.some((r) => r.id === R1.id) && client.historique.some((h) => h.type === "rdv_cree"), "le rendez-vous apparaît sur la fiche client et dans l'historique");
ok((await call("admin/rendez-vous", { token: SN, query: { vehicule: v1.dbId } })).data.some((r) => r.id === R1.id), "…et sur la fiche véhicule");
const notifsR1 = (await call("admin/rendez-vous/detail", { token: SN, query: { id: R1.id } })).data.messages;
ok(notifsR1.filter((n) => n.template === "rappel" && n.statut === "en_attente").length === 2, "rappels 24 h et 2 h planifiés", notifsR1.map((n) => n.statut));

res = await call("admin/rendez-vous", { token: SN, body: { vehiculeId: v1.dbId, clientId: R1.clientId, motif: "visite", debut: day(3, "10:15") } });
ok(res.status === 409 && res.data?.conflits?.length === 1, "chevauchement refusé (HTTP 409 + créneau en conflit)", res);
res = await call("admin/rendez-vous", { token: SN, body: { vehiculeId: v1.dbId, clientId: R1.clientId, motif: "visite", debut: day(3, "10:30") } });
ok(res.status === 200, "rendez-vous à la suite (fin du premier = début du second) accepté");
const R2 = res.data.rendezVous;

const parallel = await Promise.all(Array.from({ length: 6 }, () => call("admin/rendez-vous", { token: SN, body: { vehiculeId: v2.dbId, clientId: R1.clientId, motif: "essai", debut: day(3, "14:00") } })));
const okCount = parallel.filter((r) => r.status === 200).length, conflictCount = parallel.filter((r) => r.status === 409).length;
ok(okCount === 1 && conflictCount === 5, `6 créations simultanées sur le même créneau : ${okCount} acceptée, ${conflictCount} refusées`, parallel.map((r) => r.status));
const both = await Promise.all([v1.dbId, v2.dbId].map((vid) => call("admin/rendez-vous", { token: SN, body: { vehiculeId: vid, clientId: R1.clientId, motif: "visite", debut: day(3, "16:00") } })));
ok(both.every((r) => r.status === 200), "deux véhicules différents réservés en même temps dans le même parc");
ok((await call("admin/rendez-vous", { token: SN, body: { vehiculeId: v3.dbId, clientId: R1.clientId, motif: "visite", debut: d3 } })).status === 403, "rendez-vous sur un véhicule hors périmètre refusé");

const slots = (await call("admin/rendez-vous/creneaux", { token: SN, query: { vehicule: v1.dbId, date: d3.slice(0, 10), motif: "visite" } })).data;
const s10 = slots.creneaux.find((s) => s.debut.slice(11, 16) === "10:00"), s1130 = slots.creneaux.find((s) => s.debut.slice(11, 16) === "11:30");
ok(s10 && !s10.libre && s1130 && s1130.libre, "créneaux : occupés et libres correctement affichés");

section("4. Annulation, déplacement et rappels");
res = await call("admin/rendez-vous/annuler", { token: SN, body: { id: R2.id, raison: "Client indisponible" } });
ok(res.status === 200 && res.data.rendezVous.statut === "annule", "annulation enregistrée");
ok((await call("admin/rendez-vous", { token: SN, body: { vehiculeId: v1.dbId, clientId: R1.clientId, motif: "visite", debut: day(3, "10:30") } })).status === 200, "le créneau annulé est de nouveau libre");
const r2msgs = (await call("admin/rendez-vous/detail", { token: SN, query: { id: R2.id } })).data.messages;
ok(r2msgs.length > 0 && r2msgs.every((m) => m.statut === "annule"), "les rappels du rendez-vous annulé ne partiront pas", r2msgs.map((m) => m.statut));
res = await call("admin/rendez-vous/modifier", { token: SN, body: { id: R1.id, debut: day(3, "10:30") } });
ok(res.status === 409, "déplacement sur un créneau occupé : conflit revalidé (409)");
res = await call("admin/rendez-vous/modifier", { token: SN, body: { id: R1.id, debut: day(4, "09:00") } });
ok(res.status === 200 && res.data.proposition?.template === "modification", "déplacement accepté, message de modification proposé");
const r1after = (await call("admin/rendez-vous/detail", { token: SN, query: { id: R1.id } })).data.messages;
const pending = r1after.filter((m) => m.statut === "en_attente"), cancelled = r1after.filter((m) => m.statut === "annule");
const newStart = day(4, "09:00:00"), prevDay = new Date(newStart.slice(0, 10) + "T12:00:00Z");
prevDay.setUTCDate(prevDay.getUTCDate() - 1);
const expected = [prevDay.toISOString().slice(0, 10) + " 09:00:00", newStart.slice(0, 10) + " 07:00:00"];
ok(cancelled.length === 2 && pending.length === 2 && JSON.stringify(pending.map((m) => m.prevuLe).sort()) === JSON.stringify(expected), "anciens rappels annulés, nouveaux rappels replanifiés (24 h et 2 h avant)", r1after.map((m) => [m.statut, m.prevuLe]));
res = await call("admin/notifications/envoyer", { token: SN, body: { rendezVousId: R1.id, template: "modification", extra: res.data.proposition.extra } });
ok(res.status === 200 && ["envoye", "en_attente", "echec"].includes(res.data.statut), "envoi du message validé par la secrétaire (" + res.data?.statut + ")");

// ---------------------------------------------------------------------------------------------
section("5. Préparation, contrôle technique et documents");
const chk = (await call("admin/vehicule/checklist", { token: SN, query: { id: v1.dbId } })).data;
const nettoyage = chk.items.find((i) => i.code === "nettoyage_interieur");
res = await call("admin/vehicule/checklist", { token: SN, body: { vehiculeId: v1.dbId, itemId: nettoyage.itemId, statut: "termine", commentaire: "Aspiration + vitres" } });
ok(res.status === 200 && res.data.items.find((i) => i.code === "nettoyage_interieur").statut === "termine", "la secrétaire termine une tâche de nettoyage");
res = await call("admin/vehicule/checklist", { token: SN, body: { vehiculeId: v1.dbId, itemId: nettoyage.itemId, statut: "en_cours" } });
const partiel = res.data.items.find((i) => i.code === "nettoyage_interieur");
ok(partiel.statut === "en_cours" && partiel.commentaire === "Aspiration + vitres", "changement de statut seul : le commentaire saisi est conservé", partiel);
await call("admin/vehicule/checklist", { token: SN, body: { vehiculeId: v1.dbId, itemId: nettoyage.itemId, statut: "termine" } });
const board = (await call("admin/preparation", { token: SN })).data;
ok(board?.vehicules?.length > 0 && board.vehicules.every((v) => v.parc === nord.nom) && board.vehicules.every((v) => v.etats.length === board.taches.length),
  "tableau de préparation : véhicules du parc de la secrétaire × tâches", { n: board?.vehicules?.length, parcs: [...new Set((board?.vehicules || []).map((v) => v.parc))] });
const echeance = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
const pdf = new Blob([Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")], { type: "application/pdf" });
const upload = async (token, type, blob, name) => { const f = new FormData(); f.append("fichier", blob, name); f.append("type", type); f.append("vehiculeId", String(v1.dbId)); return call("admin/document", { token, form: f }); };
const docCt = await upload(SN, "controle_technique", pdf, "pv-ct.pdf");
ok(docCt.status === 200 && docCt.data.id, "procès-verbal de CT déposé (stockage privé)", docCt.data);
res = await call("admin/vehicule/controle-technique", { token: SN, body: { id: v1.dbId, date: new Date(Date.now() - 300 * 86400000).toISOString().slice(0, 10), resultat: "favorable", echeance, echeanceVerifiee: true, centre: "Centre test", cout: "79,90", documentId: docCt.data.id } });
ok(res.status === 200 && res.data.ct.echeance === echeance && res.data.ct.etat === "bientot" && res.data.ct.documentId === docCt.data.id, "CT : date, échéance, document visibles sur la fiche", res.data?.ct);
const evil = await upload(SN, "autre", new Blob(["<?php echo 1; ?>"], { type: "application/pdf" }), "facture.pdf");
ok(evil.status === 422, "faux PDF (script PHP) refusé");
const dl = await call("admin/document/telecharger", { token: SN, query: { id: docCt.data.id }, raw: true });
ok(dl.status === 200 && (await dl.text()).startsWith("%PDF"), "téléchargement authentifié du document");
ok((await call("admin/document/telecharger", { query: { id: docCt.data.id }, raw: true })).status === 401, "document inaccessible sans jeton");
const docAchat = await upload(A, "facture_achat", pdf, "facture-achat.pdf");
ok((await call("admin/document/telecharger", { token: SN, query: { id: docAchat.data.id }, raw: true })).status === 403, "facture d'achat réservée au propriétaire");
ok(!(await call("admin/vehicule/documents", { token: SN, query: { id: v1.dbId } })).data.some((d) => d.type === "facture_achat"), "…et absente de la liste vue par la secrétaire");
const tab = (await call("admin/tableau", { token: A })).data;
ok(tab.alertes.some((a) => a.type === "ct" && a.vehiculeId === v1.dbId), "alerte CT à venir sur le tableau de bord");
ok(tab.rdv && typeof tab.vehicules.stock === "number" && Array.isArray(tab.alertes), "tableau de bord : indicateurs issus de l'API");

// ---------------------------------------------------------------------------------------------
section("6. Vente, paiements, marge et export");
const fin = (route, body) => call(route, { token: A, body });
await fin("admin/finance/ecriture", { vehiculeId: v1.dbId, type: "achat", montant: "10000", date: "2026-01-10", tiers: "Vendeur test", documentId: docAchat.data.id });
await fin("admin/finance/ecriture", { vehiculeId: v1.dbId, type: "frais", categorie: "transport", libelle: "Convoyage", montant: "200", date: "2026-01-12" });
res = await fin("admin/finance/ecriture", { vehiculeId: v1.dbId, type: "frais", categorie: "nettoyage", libelle: "Erreur de saisie", montant: "100", date: "2026-01-13" });
const wrong = res.data.ecritures.find((e) => e.libelle === "Erreur de saisie");
res = await fin("admin/finance/contre-ecriture", { id: wrong.id, motif: "Doublon" });
ok(res.status === 200 && res.data.totaux.coutSuiviCentimes === 1020000 && res.data.ecritures.find((e) => e.id === wrong.id).annuleePar, "correction par contre-écriture (l'écriture reste visible, coût 10 200 €)", res.data?.totaux);
ok((await fin("admin/finance/contre-ecriture", { id: wrong.id, motif: "x" })).status === 409, "une écriture ne peut pas être annulée deux fois");
res = await fin("admin/vente", { vehiculeId: v1.dbId, statut: "reservee", clientId: R1.clientId, prixFinal: "12500" });
ok(res.status === 200, "réservation enregistrée", res.data);
let veh = (await call("admin/vehicule", { token: A, query: { id: v1.dbId } })).data;
ok(veh.statut === "reserve", "le véhicule passe à « réservé »");
const venteId = res.data.ventes[0].id;
await fin("admin/vente/paiement", { venteId, type: "acompte", montant: "1000", date: "2026-02-01", moyen: "cheque" });
await fin("admin/vente/paiement", { venteId, type: "partiel", montant: "2000", date: "2026-02-05", moyen: "virement" });
res = await fin("admin/vente/paiement", { venteId, type: "remboursement", montant: "500", date: "2026-02-06", moyen: "virement" });
ok(res.data.ventes[0].encaisseCentimes === 250000 && res.data.ventes[0].resteCentimes === 1000000, "acompte, paiement partiel et remboursement : solde restant exact (10 000 €)", res.data?.ventes?.[0]);
ok((await fin("admin/vente/paiement", { venteId, type: "remboursement", montant: "99999", date: "2026-02-06" })).status === 422, "remboursement supérieur aux encaissements refusé");
res = await fin("admin/vente", { id: venteId, vehiculeId: v1.dbId, statut: "finalisee", clientId: R1.clientId, prixFinal: "12500", dateVente: "2026-02-10", reference: "FV-TEST" });
ok(res.status === 200 && res.data.totaux.margeEstimeeCentimes === 230000, "vente finalisée : marge de gestion estimée 2 300 €", res.data?.totaux);
res = await fin("admin/vente", { id: venteId, vehiculeId: v1.dbId, statut: "livree", clientId: R1.clientId, prixFinal: "12500", dateVente: "2026-02-10", dateLivraison: "2026-02-15" });
veh = (await call("admin/vehicule", { token: A, query: { id: v1.dbId } })).data;
ok(veh.statut === "livre", "livraison enregistrée : véhicule « livré »");
ok((await call("admin/vehicule/supprimer", { token: A, body: { id: v1.dbId } })).status === 409, "un véhicule vendu ne peut pas être supprimé");
const finV1 = (await call("admin/finance/vehicule", { token: A, query: { id: v1.dbId } })).data;
ok(finV1.ventes[0].dateVente === "2026-02-10" && finV1.ventes[0].paiements.length === 3 && finV1.ecritures.length === 4, "le véhicule vendu reste consultable : date, prix, paiements, frais conservés");
const rap = (await call("admin/rapports", { token: A, query: { du: "2026-01-01", au: "2026-12-31" } })).data;
ok(rap.marges.some((m) => m.vehiculeId === v1.dbId && m.margeEstimeeCentimes === 230000), "rapport : marge par véhicule");
const csv = await call("admin/finance/export", { token: A, query: { du: "2026-01-01", au: "2026-12-31" }, raw: true });
const csvText = await csv.text();
ok(csv.status === 200 && (csv.headers.get("content-type") || "").includes("text/csv") && csvText.includes("FV-TEST") && csvText.includes("Contre-écriture"), "export CSV pour le comptable");
ok((await call("admin/vehicule/statut", { token: RN, body: { id: v2.dbId, statut: "vendu" } })).status === 403, "« vendu » réservé au propriétaire (vente enregistrée)");
ok((await call("admin/vehicule/statut", { token: RN, body: { id: v2.dbId, statut: "brouillon" } })).status === 200, "la référente change le statut commercial dans son parc");
ok((await call("admin/vehicule/statut", { token: A, body: { id: v2.dbId, statut: "livre" } })).status === 409, "transition non autorisée refusée (brouillon → livré)");

// ---------------------------------------------------------------------------------------------
section("7. Messages : échecs, relance, idempotence, mode test");
const fail = fixture("notif-echec", R1.id);
await call("admin/stats", { token: SN });
let n = fixture("notif", fail.id);
ok(n.statut === "echec", "message en échec après la dernière tentative", n);
let echecs = (await call("admin/notifications", { token: SN, query: { statut: "echec" } })).data;
ok(echecs.some((m) => m.id === fail.id), "échec visible dans le suivi des messages");
ok((await call("admin/tableau", { token: A })).data.alertes.some((a) => a.type === "messages"), "alerte « message en échec » sur le tableau de bord");
const before = (await call("admin/notifications", { token: A })).data.length;
res = await call("admin/notifications/relancer", { token: SN, body: { id: fail.id } });
ok(res.status === 200 && (await call("admin/notifications", { token: A })).data.length === before, "relance manuelle sans créer de doublon");
ok((await call("admin/notifications/relancer", { token: SN, body: { id: R1.id + 999999 } })).status === 404, "relance d'un message inconnu refusée");

const due = fixture("rappel-du", R1.id);
const cronKey = process.env.CRON_KEY;
await Promise.all([
  call("admin/stats", { token: SN }), call("admin/stats", { token: A }), call("admin/stats", { token: RN }),
  ...(cronKey ? [call("cron/notifications", { headers: { "X-Cron-Key": cronKey } }), call("cron/notifications", { headers: { "X-Cron-Key": cronKey } })] : []),
]);
n = fixture("notif", due.id);
ok(n.statut === "envoye" || (n.statut === "en_attente" && !MAIL_LOG) || n.statut === "echec", "rappel dû traité (" + n.statut + ")", n);
ok(Number(n.attempts) === 1, "rappel traité une seule fois malgré des passages simultanés du worker", n);
if (MAIL_LOG && fs.existsSync(MAIL_LOG)) {
  const log = fs.readFileSync(MAIL_LOG, "utf8");
  const occurrences = [...log.matchAll(new RegExp("Rappel de test idempotence " + R1.id + "(?!\\d)", "g"))].length;
  ok(occurrences === 1, "e-mail de rappel envoyé exactement une fois", occurrences);
  const redirect = (await call("admin/references", { token: A })).data.redirectionEmail;
  const tos = [...log.matchAll(/^To: (.+)$/gm)].map((m) => m[1].trim());
  ok(redirect && tos.length > 0 && tos.every((t) => t === redirect) && log.includes("— Mode test : ce message était destiné à "), `mode test : les ${tos.length} e-mails partent tous vers ${redirect}, destinataire prévu indiqué`, [...new Set(tos)]);
}
ok((await call("cron/notifications", { headers: { "X-Cron-Key": "mauvaise-cle" } })).status === 404, "point d'envoi planifié protégé par une clé");

// ---------------------------------------------------------------------------------------------
section("8. Demandes du site et clients");
res = await call("demandes", { body: { vehiculeId: pub.data[0].id, type: "offre", nom: "Jean Test" + uniq, tel: client.telephone, email: "", montant: 20000, message: "Offre test" } });
ok(res.status === 201, "demande publique enregistrée (site inchangé)");
const dem = (await call("admin/demandes", { token: A })).data.find((d) => d.id === res.data.id);
ok(dem && dem.clientSuggere && dem.clientSuggere.id === R1.clientId && !dem.client, "client existant détecté (même téléphone) mais pas associé sans validation", dem);
res = await call("admin/demande/associer", { token: A, body: { id: dem.id, clientId: R1.clientId } });
ok(res.status === 200 && (await call("admin/client", { token: A, query: { id: R1.clientId } })).data.historique.some((h) => h.type === "demande_site"), "association validée : demande dans l'historique client");
res = await call("admin/client", { token: SN, body: { nom: "Doublon", telephone: client.telephone } });
ok(res.status === 409 && res.data.doublons?.length >= 1, "création d'un doublon signalée (validation humaine requise)");
res = await call("admin/client/contact", { token: SN, body: { clientId: R1.clientId, type: "appel_entrant", resume: "Appel pour confirmer l'heure" } });
ok(res.status === 200 && res.data.historique[0].type === "appel_entrant", "saisie d'un appel téléphonique dans l'historique");

// ---------------------------------------------------------------------------------------------
section("9. Retrait d'accès, désactivation, paramètres, journal");
res = await call("admin/utilisateur", { token: A, body: { id: secN.id, name: secN.name, role: "secretaire", actif: true, parcs: [] } });
ok(res.status === 200 && res.data.parcs.length === 0, "accès au parc Nord retiré");
ok((await call("admin/vehicule", { token: SN, query: { id: v2.dbId } })).status === 403, "la secrétaire n'accède plus au parc Nord");
ok((await call("admin/rendez-vous/detail", { token: A, query: { id: R1.id } })).status === 200, "l'historique (rendez-vous) est conservé");
const audit = (await call("admin/audit", { token: A, query: { entity_type: "utilisateur", entity_id: secN.id } })).data;
ok(audit.some((a) => a.action === "parc.retirer") && audit.some((a) => a.action === "parc.affecter"), "journal d'audit : affectation et retrait tracés");
await call("admin/utilisateur", { token: A, body: { id: secS.id, name: secS.name, role: "secretaire", actif: false, parcs: [sud.id] } });
ok((await call("admin/vehicules", { token: SS })).status === 401 && !(await login(`sec.sud.${uniq}@test.local`, pwd)), "compte désactivé : sessions fermées et connexion refusée");
await call("admin/parametres", { token: A, body: { motifs: [{ code: "visite", libelle: "Visite du véhicule", duree: 30 }, { code: "essai", libelle: "Essai", duree: 60 }, { code: "appel", libelle: "Appel", duree: 15 }, { code: "controle_technique", libelle: "Contrôle technique", duree: 60 }, { code: "livraison", libelle: "Livraison", duree: 60 }, { code: "documents", libelle: "Remise de documents", duree: 30 }] } });
res = await call("admin/rendez-vous", { token: A, body: { vehiculeId: v2.dbId, clientId: R1.clientId, motif: "essai", debut: day(5, "09:00") } });
ok(res.status === 200 && res.data.rendezVous.fin.slice(11, 16) === "10:00", "durée par défaut configurable par motif (essai : 60 min)");
ok((await call("admin/parc", { token: A, body: { id: nord.id, code: nord.code, nom: nord.nom, actif: false } })).status === 409, "un parc contenant des véhicules ne peut pas être désactivé");
res = await call("admin/vehicule/transfert", { token: A, body: { id: v2.dbId, parcId: sud.id, commentaire: "Test transfert" } });
ok(res.status === 200 && res.data.avertissements.length >= 1, "transfert de parc : historique + avertissement sur les rendez-vous à venir", res.data);
const hist = (await call("admin/vehicule/historique", { token: A, query: { id: v2.dbId } })).data;
ok(hist.mouvements[0]?.commentaire === "Test transfert", "mouvement de parc conservé (origine, destination, auteur, date)");

// ---------------------------------------------------------------------------------------------
section("10. Démonstration séparée");
const demoLogin = await call("auth/demo", { demo: true, body: { role: "secretaire" } });
ok(demoLogin.status === 200 && demoLogin.data.user.role === "secretaire", "connexion de démonstration (profil secrétaire)");
const demoVeh = (await call("admin/vehicules", { token: demoLogin.data.token, demo: true })).data;
ok(Array.isArray(demoVeh) && demoVeh.length === 12, "démo : la secrétaire ne voit que son parc (12 véhicules)", demoVeh?.length);
ok((await call("admin/vehicules", { token: demoLogin.data.token })).status === 401, "un jeton de démo ne donne aucun accès à la base réelle");
ok((await call("auth/demo", { body: { role: "admin" } })).status === 404, "connexion sans mot de passe impossible hors démonstration");

console.log(`\n${passes} réussis, ${failures} échoués`);
process.exit(failures ? 1 : 0);
