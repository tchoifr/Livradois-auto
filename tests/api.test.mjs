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

const jr = (await call("admin/journee", { token: SN, query: { date: d3.slice(0, 10) } })).data;
ok(jr && jr.rendezVous.some((r) => r.id === R1.id) && Array.isArray(jr.preparation.taches) && jr.secretariat && jr.proprietaire === null,
  "page Aujourd'hui (secrétaire) : rendez-vous du jour, préparation, secrétariat, sans les données du propriétaire", jr && { rdv: jr.rendezVous.length, proprio: jr.proprietaire });
const jrA = (await call("admin/journee", { token: A, query: { date: d3.slice(0, 10) } })).data;
ok(jrA && jrA.proprietaire && "aEncaisser" in jrA.proprietaire && jrA.rendezVous.some((r) => r.id === R1.id), "page Aujourd'hui (propriétaire) : partie gestion présente");
const slots = (await call("admin/rendez-vous/creneaux", { token: SN, query: { vehicule: v1.dbId, date: d3.slice(0, 10), motif: "visite" } })).data;
const s10 = slots.creneaux.find((s) => s.debut.slice(11, 16) === "10:00"), s1130 = slots.creneaux.find((s) => s.debut.slice(11, 16) === "11:30");
ok(s10 && !s10.libre && s1130 && s1130.libre, "créneaux : occupés et libres correctement affichés");
const pasVisite = slots.creneaux.slice(1).every((s, i) => s.debut.slice(0, 10) !== slots.creneaux[i].debut.slice(0, 10) || new Date(s.debut.replace(" ", "T")) - new Date(slots.creneaux[i].debut.replace(" ", "T")) >= 30 * 60000);
const essai = (await call("admin/rendez-vous/creneaux", { token: SN, query: { vehicule: v1.dbId, date: d3.slice(0, 10), motif: "visite", duree: 45 } })).data;
ok(pasVisite && !slots.creneaux.some((s) => s.debut.slice(14, 16) === "15") && essai.creneaux.slice(0, 3).map((s) => s.debut.slice(11, 16)).join(",") === "08:00,08:45,09:30",
  "créneaux proposés selon la durée du rendez-vous (30 min : 8h00, 8h30… ; 45 min : 8h00, 8h45, 9h30)", essai.creneaux.slice(0, 4).map((s) => s.debut.slice(11, 16)));

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

// ---------------------------------------------------------------------------------------------
section("11. Diffusion multicanale (site, Leboncoin, La Centrale)");
const today = new Date().toISOString().slice(0, 10);
const descD = "Véhicule de test pour la diffusion multicanale : entretien à jour, carnet complet, deux clés, contrôle technique sans défaut.";
const photosD = [1, 2, 3, 4, 5].map((i) => ({ url: "/public/vehicules/test-diffusion-" + i + ".webp" }));
const vD = (await mkVeh(A, nord.id, "Toyota", "Yaris", { statut: "brouillon", description: descD, photos: photosD, miseEnCirculation: "2020-03" })).data;
const difV = async (token = A) => (await call("admin/diffusion/vehicule", { token, query: { id: vD.dbId } })).data;
let dif = await difV();
const cn = (code, d = dif) => d.canaux.find((c) => c.code === code);
ok(cn("site") && cn("leboncoin") && cn("lacentrale"), "canaux de diffusion : site, Leboncoin, La Centrale");
ok(cn("leboncoin").mode === "manuel" && cn("lacentrale").mode === "manuel" && cn("leboncoin").unClic.etat === "abonnement" && cn("leboncoin").raisonManuel.includes("abonnés") && cn("leboncoin").capacites.length === 0,
  "Leboncoin et La Centrale en publication assistée : aucune publication automatique simulée", cn("leboncoin"));
ok(cn("site").statut === "non_publie" && cn("leboncoin").donnees.titre.startsWith("Toyota Yaris") && cn("leboncoin").donnees.photos.length === 5, "brouillon non publié ; annonce préparée depuis la fiche (titre, photos)");
const LBC = cn("leboncoin").canalId, LC = cn("lacentrale").canalId, SITE = cn("site").canalId;
res = await call("admin/diffusion/publier", { token: A, body: { vehiculeId: vD.dbId, canaux: [SITE, LBC] } });
const rs = (id) => res.data.resultats.find((r) => r.canalId === id);
ok(res.status === 200 && rs(SITE).ok && cn("site", res.data.diffusion).statut === "publie", "« Publier » : annonce en ligne sur le site", res.data);
ok(rs(LBC).ok === false && rs(LBC).manuel === true, "Leboncoin : pas de faux succès, publication assistée proposée");
ok((await call("vehicules")).data.some((v) => v.id === vD.id), "l'annonce apparaît sur le site public");
ok((await call("admin/diffusion/manuel", { token: A, body: { vehiculeId: vD.dbId, canalId: LBC, action: "publie", url: "https://www.exemple.com/annonce/1" } })).status === 422, "publication assistée : lien d'un autre site refusé");
ok((await call("admin/diffusion/manuel", { token: A, body: { vehiculeId: vD.dbId, canalId: LBC, action: "publie", url: "http://www.leboncoin.fr/ad/voitures/1" } })).status === 422, "…lien non https refusé");
ok((await call("admin/diffusion/manuel", { token: A, body: { vehiculeId: vD.dbId, canalId: LBC, action: "publie" } })).status === 422, "…lien ou référence obligatoire");
const exp = new Date(Date.now() + 60 * 86400e3).toISOString().slice(0, 10);
res = await call("admin/diffusion/manuel", { token: A, body: { vehiculeId: vD.dbId, canalId: LBC, action: "publie", url: "https://www.leboncoin.fr/ad/voitures/2999999999", reference: "2999999999", expireLe: exp } });
ok(res.status === 200 && cn("leboncoin", res.data).statut === "publie" && cn("leboncoin", res.data).url.includes("leboncoin.fr") && cn("leboncoin", res.data).expireLe === exp && cn("leboncoin", res.data).prixPublie === 12500,
  "publication assistée enregistrée : lien, référence, expiration, prix publié", cn("leboncoin", res.data));
res = await call("admin/diffusion/manuel", { token: A, body: { vehiculeId: vD.dbId, canalId: LC, action: "publie", reference: "LC-TEST-1" } });
ok(res.status === 200 && cn("lacentrale", res.data).statut === "publie", "La Centrale : publication assistée enregistrée avec sa référence");
// Fiche modifiée → annonces à mettre à jour (la fiche reste la référence)
const fullD = (await call("admin/vehicule", { token: A, query: { id: vD.dbId } })).data;
await call("admin/vehicule", { token: A, body: { ...fullD, prix: 11900 } });
dif = await difV();
ok(cn("leboncoin").statut === "a_mettre_a_jour" && cn("lacentrale").statut === "a_mettre_a_jour" && cn("leboncoin").aJour === false, "prix modifié : annonces Leboncoin et La Centrale « à mettre à jour »");
ok(dif.historique.some((h) => h.message.includes("12 500 € → 11 900 €")), "historique : ancien et nouveau prix", dif.historique.slice(0, 3));
const todoD = (await call("admin/journee", { token: A })).data;
ok(todoD.diffusion?.items?.some((i) => i.vehiculeId === vD.dbId && i.statut === "a_mettre_a_jour"), "« À faire » du tableau de bord : annonce à mettre à jour", todoD.diffusion);
res = await call("admin/diffusion/manuel", { token: A, body: { vehiculeId: vD.dbId, canalId: LBC, action: "mis_a_jour" } });
ok(cn("leboncoin", res.data).statut === "publie" && cn("leboncoin", res.data).prixPublie === 11900 && cn("leboncoin", res.data).aJour, "mise à jour confirmée : publiée au nouveau prix");
// Adaptation propre à une plateforme
res = await call("admin/diffusion/adaptation", { token: A, body: { vehiculeId: vD.dbId, canalId: LBC, titre: "Toyota Yaris hybride — garantie 12 mois", description: descD + " Spécial Leboncoin.", photos: photosD.slice(0, 3).map((p) => p.url) } });
const adapt = cn("leboncoin", res.data);
ok(res.status === 200 && adapt.donnees.titre === "Toyota Yaris hybride — garantie 12 mois" && adapt.donnees.titrePerso && adapt.donnees.photos.length === 3 && adapt.statut === "a_mettre_a_jour",
  "adaptation Leboncoin (titre, description, 3 photos) : à republier", adapt?.donnees);
const ficheApres = (await call("admin/vehicule", { token: A, query: { id: vD.dbId } })).data;
ok(ficheApres.description === descD && ficheApres.photos.length === 5 && cn("lacentrale", res.data).donnees.titre.startsWith("Toyota Yaris Test"), "la fiche du véhicule et les autres plateformes ne sont pas modifiées");
await call("admin/diffusion/manuel", { token: A, body: { vehiculeId: vD.dbId, canalId: LBC, action: "mis_a_jour" } });
// Expiration
fixture("publication-expiree", vD.dbId, LBC);
dif = await difV();
ok(cn("leboncoin").statut === "expire", "annonce arrivée à expiration : « à renouveler »");
res = await call("admin/diffusion/manuel", { token: A, body: { vehiculeId: vD.dbId, canalId: LBC, action: "renouvele", expireLe: exp } });
ok(cn("leboncoin", res.data).statut === "publie", "renouvellement enregistré");
ok((await call("admin/diffusion/manuel", { token: A, body: { vehiculeId: vD.dbId, canalId: LC, action: "refuse" } })).status === 422, "refus d'une plateforme : motif obligatoire");
// Droits
ok((await call("admin/diffusion/vehicule", { token: RN, query: { id: vD.dbId } })).status === 200, "la référente du parc consulte la diffusion");
ok((await call("admin/diffusion/vehicule", { token: RN, query: { id: v3.dbId } })).status === 403, "…mais pas celle d'un autre parc");
ok((await call("admin/diffusion/compte", { token: RN, body: { canalId: LBC, abonnementActif: true } })).status === 403, "seul le propriétaire gère les comptes de diffusion");
// Comptes de diffusion : abonnement + accès API chiffrés, test réel uniquement vers la plateforme
let comptes = (await call("admin/diffusion/comptes", { token: A })).data.plateformes;
const cLbc = comptes.find((c) => c.code === "leboncoin");
ok(cLbc && cLbc.statut === "non_connecte" && cLbc.conditions.includes("pro") && cLbc.publicationAuto === false, "compte Leboncoin : non connecté, conditions d'accès affichées");
ok((await call("admin/diffusion/compte", { token: A, body: { canalId: LBC, methode: "oauth2_client", urlJeton: "https://evil.example.com/oauth/token" } })).status === 422, "adresse d'authentification hors domaine Leboncoin refusée");
ok((await call("admin/diffusion/compte", { token: A, body: { canalId: LBC, methode: "oauth2_client", urlJeton: "http://api.leboncoin.fr/oauth/token" } })).status === 422, "…adresse non https refusée");
ok((await call("admin/diffusion/compte", { token: A, body: { canalId: LBC, methode: "oauth2_client", urlJeton: "https://api.leboncoin.fr:8443/oauth/token" } })).status === 422, "…port non standard refusé");
const secretTest = "secret-test-" + uniq + "-ne-doit-jamais-sortir";
res = await call("admin/diffusion/compte", { token: A, body: { canalId: LBC, abonnementActif: false, methode: "oauth2_client", urlJeton: "https://api.leboncoin.fr/oauth/token", identifiant: "client-test-" + uniq, secret: secretTest } });
ok(res.status === 200 && res.data.secretEnregistre === true && !JSON.stringify(res.data).includes(secretTest) && res.data.identifiant !== "client-test-" + uniq, "accès enregistrés : secret jamais renvoyé, identifiant masqué", res);
const brut = fixture("compte-brut", LBC);
ok(/^v[12]:/.test(brut.stocke || "") && !brut.stocke.includes(secretTest) && brut.dechiffre === secretTest, "secret chiffré en base (chiffrement authentifié), déchiffrable par le serveur seul", { brut, n: secretTest.length });
res = await call("admin/diffusion/compte/tester", { token: A, body: { canalId: LBC } });
ok(res.status === 409 && res.data.error.includes("abonnement"), "test de connexion impossible sans abonnement pro actif", res.data);
await call("admin/diffusion/compte", { token: A, body: { canalId: LBC, abonnementActif: true, abonnementFin: "2020-01-01" } });
ok((await call("admin/diffusion/compte/tester", { token: A, body: { canalId: LBC } })).status === 409, "…ni avec un abonnement terminé");
comptes = (await call("admin/diffusion/comptes", { token: A })).data.plateformes;
ok(fixture("compte-brut", LBC).dechiffre === secretTest && comptes.find((c) => c.code === "leboncoin").statut === "non_connecte", "abonnement modifié sans retoucher les accès : secret conservé, toujours non connecté");
const aj = fixture("analyse-jeton");
ok(aj.ok.ok && aj.ok.jeton === "abc" && aj.ok.expire === 1800 && !aj.refuse.ok && aj.refuse.message.includes("401") && !aj.limite.ok && !aj.injoignable.ok && !aj.sansJeton.ok, "lecture des réponses OAuth 2.0 (accepté, refusé, limite, injoignable)");
res = await call("admin/diffusion/compte/deconnecter", { token: A, body: { canalId: LBC } });
ok(res.status === 200 && res.data.secretEnregistre === false && fixture("compte-brut", LBC).stocke === null, "déconnexion : accès effacés du serveur");
// Vente → retrait des annonces ; vente annulée → annonces conservées
res = await call("admin/vente", { token: A, body: { vehiculeId: vD.dbId, statut: "finalisee", acheteur: "Acheteur diffusion", prixFinal: "11900", dateVente: today } });
ok(res.status === 200, "vente finalisée", res.data);
dif = await difV();
ok(cn("site").statut === "vendu" && cn("leboncoin").statut === "a_retirer" && cn("lacentrale").statut === "a_retirer", "véhicule vendu : retiré du site, annonces Leboncoin et La Centrale « à retirer »");
ok(!(await call("vehicules")).data.some((v) => v.id === vD.id), "le véhicule vendu n'est plus sur le site public");
const ov = (await call("admin/diffusion", { token: A })).data;
ok(ov.compteurs.aRetirer >= 2 && ov.lignes.some((l) => l.vehiculeId === vD.dbId), "vue d'ensemble : annonces à retirer comptées, véhicule vendu encore listé");
const venteD = (await call("admin/finance/vehicule", { token: A, query: { id: vD.dbId } })).data.ventes[0];
await call("admin/vente", { token: A, body: { id: venteD.id, vehiculeId: vD.dbId, statut: "annulee" } });
dif = await difV();
ok(cn("site").statut === "publie" && cn("leboncoin").statut === "publie", "vente annulée : annonces conservées (plus rien à retirer)");
await call("admin/vehicule/statut", { token: A, body: { id: vD.dbId, statut: "retire" } });
res = await call("admin/diffusion/manuel", { token: A, body: { vehiculeId: vD.dbId, canalId: LBC, action: "retire" } });
ok(cn("leboncoin", res.data).statut === "retire" && cn("lacentrale", res.data).statut === "a_retirer", "retrait confirmé plateforme par plateforme");
const histD = (await call("admin/diffusion/historique", { token: A, query: { vehicule: vD.dbId, canal: LBC } })).data;
ok(histD.length >= 6 && histD.every((h) => h.canal === "Leboncoin") && histD.some((h) => h.action === "manuel_publie" && h.acteur), "historique filtré par véhicule et plateforme (auteur, date, résultat)");
ok((await call("admin/diffusion/historique", { token: A, query: { vehicule: vD.dbId, resultat: "echec" } })).data.every((h) => h.resultat === "echec"), "historique filtré par résultat");
// File d'opérations sur la plateforme de test (connecteur automatique, activé uniquement pour les tests)
const vS = (await mkVeh(A, nord.id, "Skoda", "Fabia", { description: descD, photos: photosD, miseEnCirculation: "2021-05" })).data;
const difS = async () => (await call("admin/diffusion/vehicule", { token: A, query: { id: vS.dbId } })).data;
const SB = cn("bac_a_sable", await difS());
if (!SB) {
  ok(false, "plateforme de test active (réglage diffusion_bac_a_sable)");
} else {
  ok(SB.mode === "auto" && SB.capacites.includes("retirer"), "plateforme de test : publication automatique déclarée (publier, modifier, retirer)");
  res = await call("admin/diffusion/publier", { token: A, body: { vehiculeId: vS.dbId, canaux: [SB.canalId] } });
  ok(res.data.resultats[0].ok && cn("bac_a_sable", res.data.diffusion).statut === "publie" && cn("bac_a_sable", res.data.diffusion).reference.startsWith("TEST-"), "publication confirmée par la plateforme : référence enregistrée", res.data.resultats);
  const fullS = (await call("admin/vehicule", { token: A, query: { id: vS.dbId } })).data;
  await call("admin/vehicule", { token: A, body: { ...fullS, prix: 9900 } });
  await call("admin/vehicule", { token: A, body: { ...fullS, prix: 9900 } });
  let taches = fixture("diffusion-taches", vS.dbId).filter((t) => t.action === "modifier" && t.statut === "en_attente");
  ok(taches.length === 1 && cn("bac_a_sable", await difS()).statut === "a_mettre_a_jour", "prix modifié : une seule mise à jour en file (pas de doublon), en attente de confirmation", taches);
  await call("admin/stats", { token: A });
  let sb = cn("bac_a_sable", await difS());
  ok(sb.statut === "publie" && sb.prixPublie === 9900, "mise à jour envoyée et confirmée : prix 9 900 €", sb);
  await call("admin/diffusion/adaptation", { token: A, body: { vehiculeId: vS.dbId, canalId: SB.canalId, description: descD + " [ECHEC]" } });
  res = await call("admin/diffusion/synchroniser", { token: A, body: { vehiculeId: vS.dbId, canalId: SB.canalId } });
  sb = cn("bac_a_sable", res.data);
  ok(sb.statut === "erreur" && sb.erreur.includes("refusée") && res.data.historique[0].resultat === "echec", "refus de la plateforme : statut « erreur », message clair, jamais affiché comme réussi", sb);
  await call("admin/diffusion/adaptation", { token: A, body: { vehiculeId: vS.dbId, canalId: SB.canalId, description: descD + " [TEMPORAIRE]" } });
  res = await call("admin/diffusion/synchroniser", { token: A, body: { vehiculeId: vS.dbId, canalId: SB.canalId } });
  taches = fixture("diffusion-taches", vS.dbId).filter((t) => t.statut === "en_attente");
  ok(taches.length === 1 && taches[0].tentatives === 1 && cn("bac_a_sable", res.data).erreur.includes("Nouvel essai"), "panne passagère : nouvel essai automatique programmé", taches);
  await call("admin/diffusion/adaptation", { token: A, body: { vehiculeId: vS.dbId, canalId: SB.canalId, description: "" } });
  fixture("diffusion-taches", vS.dbId, "dues");
  await call("admin/stats", { token: A });
  sb = cn("bac_a_sable", await difS());
  ok(sb.statut === "publie" && sb.erreur === "" && sb.tachesEnCours === 0, "nouvel essai réussi : annonce à jour", { sb, t: fixture("diffusion-taches", vS.dbId) });
  await call("admin/vehicule/statut", { token: A, body: { id: vS.dbId, statut: "retire" } });
  ok(cn("bac_a_sable", await difS()).statut === "a_retirer", "véhicule retiré de la vente : retrait demandé à la plateforme");
  const cron = await call("cron/notifications", { headers: { "X-Cron-Key": process.env.CRON_KEY || "" } });
  sb = cn("bac_a_sable", await difS());
  ok(cron.status === 200 && sb.statut === "retire", "tâche planifiée : retrait confirmé par la plateforme", cron.data);
}

// ---------------------------------------------------------------------------------------------
section("12. Publication en 1 clic : contrôles et erreurs des plateformes");
const ar = fixture("analyse-reponse");
ok(ar.cree.ok && ar.cree.reference === "12345" && ar.cree.url.includes("lacentrale.fr"), "réponse 201 : référence et lien de l'annonce lus", ar.cree);
ok(!ar.sansRef.ok && ar.sansRef.message.includes("non confirmée"), "réponse sans référence : publication non confirmée (jamais affichée comme réussie)");
ok(ar.refus.type === "refus" && ar.refus.message.includes("mileage : doit être positif") && !ar.refus.temporaire, "refus de la plateforme : motif détaillé, pas de nouvel essai", ar.refus);
ok(ar.abonnement.type === "abonnement" && ar.abonnement403.type === "abonnement" && ar.abonnement.message.includes("offre pro payante") && ar.quota.type === "quota" && ar.droits.type === "droits",
  "offre payante requise / limite de l'offre atteinte / droits insuffisants : distingués", { a: ar.abonnement, q: ar.quota });
ok(ar.connexion.type === "connexion" && ar.limite.temporaire && ar.panne.temporaire && ar.injoignable.temporaire, "accès expirés → reconnexion ; trop de demandes ou panne → nouvel essai automatique");
ok(ar.dejaRetiree.ok && ar.introuvable.type === "introuvable", "retrait d'une annonce déjà absente accepté ; modification d'une annonce disparue signalée");
ok(ar.modele.ok === "" && ar.modele.guillemets.includes("guillemets") && ar.modele.inconnue.includes("intitule") && ar.modele.json.includes("JSON") && JSON.parse(ar.modele.corps).t === 'Clio "RS"',
  "modèle d'annonce : variables contrôlées, valeurs échappées", ar.modele);
ok((await call("admin/diffusion/compte", { token: A, body: { canalId: LC, apiUrlCreation: "https://api.exemple.com/annonces" } })).status === 422, "adresse de publication hors domaine La Centrale refusée");
res = await call("admin/diffusion/compte", { token: A, body: { canalId: LC, apiModele: '{"title": "{{titre}}"}' } });
ok(res.status === 422 && res.data.error.includes("guillemets"), "modèle mal écrit refusé avec explication", res.data);
ok((await call("admin/diffusion/compte", { token: A, body: { canalId: LC, apiActif: true } })).status === 422, "1 clic impossible à activer sans adresse ni modèle");
const modeleLC = '{"title": {{titre}}, "price": {{prix}}, "mileage": {{km}}, "year": {{annee}}, "description": {{description}}, "pictures": {{photos}}}';
res = await call("admin/diffusion/compte", { token: A, body: { canalId: LC, apiActif: true, apiMethodeCreation: "POST", apiUrlCreation: "https://api.lacentrale.fr/v1/annonces",
  apiMethodeModification: "PUT", apiUrlModification: "https://api.lacentrale.fr/v1/annonces/{reference}", apiMethodeRetrait: "DELETE", apiUrlRetrait: "https://api.lacentrale.fr/v1/annonces/{reference}",
  apiCheminReference: "data.id", apiModele: modeleLC } });
ok(res.status === 200 && res.data.publicationAuto && res.data.capacites.length === 3 && res.data.unClic.etat === "abonnement", "API de publication La Centrale enregistrée : 1 clic en attente de l'abonnement", res.data?.unClic);
ok((await call("admin/diffusion/compte", { token: RN, body: { canalId: LC, apiActif: false } })).status === 403, "seul le propriétaire configure la publication en 1 clic");
const vP = (await mkVeh(A, nord.id, "Renault", "Megane", { description: descD, photos: photosD, miseEnCirculation: "2022-01" })).data;
res = await call("admin/diffusion/compte/apercu", { token: A, body: { canalId: LC, vehiculeId: vP.dbId } });
const corpsLC = res.status === 200 ? JSON.parse(res.data.corps) : {};
ok(corpsLC.price === 12500 && corpsLC.title.startsWith("Renault Megane") && corpsLC.pictures.length === 5 && corpsLC.pictures[0].startsWith("http") && res.data.requete.startsWith("POST https://api.lacentrale.fr"),
  "aperçu de l'envoi : JSON de l'annonce, photos en adresses complètes, aucun appel", res.data);
let r1 = (await call("admin/diffusion/publier", { token: A, body: { vehiculeId: vP.dbId, canaux: [LC] } })).data.resultats[0];
ok(!r1.ok && r1.bloque === "abonnement" && r1.aide.includes("lacentrale") && r1.message.includes("abonnés"), "1 clic sans abonnement : bloqué, lien vers les offres La Centrale", r1);
await call("admin/diffusion/compte", { token: A, body: { canalId: LC, abonnementActif: true, abonnementOffre: "Pack Business" } });
r1 = (await call("admin/diffusion/publier", { token: A, body: { vehiculeId: vP.dbId, canaux: [LC] } })).data.resultats[0];
ok(!r1.ok && r1.bloque === "non_connecte" && r1.message.includes("non connecté"), "abonnement indiqué mais compte non connecté : connexion demandée", r1);
const dP = (await call("admin/diffusion/vehicule", { token: A, query: { id: vP.dbId } })).data;
ok(cn("lacentrale", dP).mode === "manuel" && cn("lacentrale", dP).unClic.etat === "non_connecte" && cn("lacentrale", dP).statut === "non_publie", "rien n'est publié tant que la connexion n'est pas vérifiée (publication assistée proposée)");
if (SB) {
  const vE = (await mkVeh(A, nord.id, "Opel", "Corsa", { description: descD, photos: photosD, miseEnCirculation: "2021-02" })).data;
  const pubE = () => call("admin/diffusion/publier", { token: A, body: { vehiculeId: vE.dbId, canaux: [SB.canalId] } });
  await call("admin/diffusion/adaptation", { token: A, body: { vehiculeId: vE.dbId, canalId: SB.canalId, description: descD + " [ECHEC]" } });
  res = await pubE();
  let sbE = cn("bac_a_sable", res.data.diffusion);
  ok(!res.data.resultats[0].ok && res.data.resultats[0].type === "refus" && sbE.statut === "refuse" && sbE.erreurType === "refus" && sbE.erreur.includes("Description non conforme"), "1 clic refusé par la plateforme : « Refusé » avec le motif", sbE);
  ok((await call("admin/journee", { token: A })).data.diffusion.items.some((i) => i.vehiculeId === vE.dbId && i.statut === "refuse"), "annonce refusée dans « À faire »");
  await call("admin/diffusion/adaptation", { token: A, body: { vehiculeId: vE.dbId, canalId: SB.canalId, description: descD + " [ABONNEMENT]" } });
  res = await pubE();
  sbE = cn("bac_a_sable", res.data.diffusion);
  ok(res.data.resultats[0].type === "abonnement" && sbE.statut === "erreur" && sbE.erreurType === "abonnement" && sbE.erreur.includes("offre pro payante"), "offre payante exigée par la plateforme : erreur « abonnement » explicite", sbE);
  await call("admin/diffusion/adaptation", { token: A, body: { vehiculeId: vE.dbId, canalId: SB.canalId, description: descD + " [QUOTA]" } });
  res = await pubE();
  ok(res.data.resultats[0].type === "quota" && cn("bac_a_sable", res.data.diffusion).erreurType === "quota", "limite d'annonces de l'offre atteinte : erreur « quota »", res.data.resultats[0]);
  await call("admin/diffusion/adaptation", { token: A, body: { vehiculeId: vE.dbId, canalId: SB.canalId, description: "" } });
  res = await pubE();
  sbE = cn("bac_a_sable", res.data.diffusion);
  ok(res.data.resultats[0].ok && sbE.statut === "publie" && sbE.erreurType === "" && sbE.erreur === "", "après correction : publié en 1 clic, erreur effacée", sbE);
}

console.log(`\n${passes} réussis, ${failures} échoués`);
process.exit(failures ? 1 : 0);
