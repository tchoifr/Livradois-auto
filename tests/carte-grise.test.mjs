/*
 * Tests de la lecture de carte grise : extraire() et critair() (admin/assets/carte-grise.js).
 * Fonctions pures, sans navigateur ni serveur.
 * Usage : node tests/carte-grise.test.mjs
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { extraire, critair } = require("../admin/assets/carte-grise.js");

let failures = 0, passes = 0;
const ok = (cond, label, detail) => {
  if (cond) { passes++; console.log("  ✔ " + label); }
  else { failures++; console.log("  ✘ " + label + (detail !== undefined ? " → " + JSON.stringify(detail).slice(0, 400) : "")); }
};
const section = (t) => console.log("\n" + t);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* Texte propre : toutes les rubriques lues (le titulaire n'y figure pas) */
const propre = [
  "A AB-123-CD",
  "B 15/03/2018",
  "D.1 PEUGEOT",
  "D.3 3008",
  "E VF3MCYHZRJS120456",
  "J.1 VP",
  "J.2 AC",
  "P.2 96",
  "P.3 GO",
  "P.6 6",
  "S.1 5",
  "V.9 EURO 6",
].join("\n");
const avec = (remplacements) => Object.entries(remplacements).reduce((t, [a, b]) => t.replace(a, b), propre);

section("Texte propre : les 12 champs, aucun « à vérifier »");
let r = extraire(propre);
ok(Object.keys(r.champs).length === 12, "12 champs remplis", Object.keys(r.champs));
ok(same(r.aVerifier, []), "aucun champ à vérifier", r.aVerifier);
ok(r.champs.immatriculation === "AB-123-CD", "immatriculation AB-123-CD", r.champs.immatriculation);
ok(r.champs.miseEnCirculation === "03/2018" && r.champs.annee === 2018, "mise en circulation 03/2018 et année 2018", [r.champs.miseEnCirculation, r.champs.annee]);
ok(r.champs.marque === "Peugeot" && r.champs.modele === "3008", "marque Peugeot, modèle 3008", [r.champs.marque, r.champs.modele]);
ok(r.champs.vin === "VF3MCYHZRJS120456", "VIN", r.champs.vin);
ok(r.champs.carrosserie === "Break", "J.2 AC → Break", r.champs.carrosserie);
ok(r.champs.puissance === 131 && r.champs.cv === 6 && r.champs.places === 5, "puissance 131 ch, 6 CV, 5 places", r.champs);
ok(r.champs.energie === "Diesel", "P.3 GO → Diesel", r.champs.energie);
ok(r.champs.critair === 2, "Crit'Air 2 (gazole, Euro 6)", r.champs.critair);

section("Codes abîmés : D1, P. 6, S.l donnent les mêmes valeurs");
r = extraire(avec({ "D.1": "D1", "P.6": "P. 6", "S.1": "S.l" }));
ok(same(r.champs, extraire(propre).champs), "mêmes champs que le texte propre", r.champs);
ok(same(r.aVerifier, []), "toujours aucun champ à vérifier", r.aVerifier);
r = extraire(avec({ "D.3": "D. 3", "J.2": "J2", "P.2": "P.2" }));
ok(same(r.champs, extraire(propre).champs), "D. 3 et J2 aussi", r.champs);
r = extraire(avec({ "P.3": "P.3", "S.1": "S.I", "V.9": "V9" }));
ok(same(r.champs, extraire(propre).champs), "S.I (I lu pour 1) et V9", r.champs);

section("Codes collés à leur valeur (sortie réelle de Tesseract sur un spécimen : J2AC, P.3GO, P.66, S.15)");
const sortieTesseract = [
  "CERTIFICAT D'IMMATRICULATION SPECIMEN", "A AB-123-CD", "B 15/03/2018", "C.1 ZZPRIVATEZZ SPECIMEN", "C.3 1 RUE DE L'EXEMPLE 63600 AMBERT",
  "D.1 PEUGEOT", "D.3 3008", "E VF3MCYHZRJS120456", "J.1 VP", "J2AC", "P.2 96", "P.3GO", "P.66", "S.15", "V.9 EURO 6",
].join("\n");
r = extraire(sortieTesseract);
ok(same(r.champs, extraire(propre).champs), "mêmes 12 champs que le texte propre", r.champs);
ok(same(r.aVerifier, []), "aucun champ à vérifier", r.aVerifier);
ok(!/ZZPRIVATEZZ|EXEMPLE|AMBERT/.test(JSON.stringify(r)), "titulaire toujours exclu", r);
r = extraire(sortieTesseract, [{ texte: "J.1", confiance: 28 }, { texte: "VP", confiance: 28 }, { texte: "P.2", confiance: 27 }, { texte: "96", confiance: 27 }, { texte: "P.3GO", confiance: 55 }]);
ok(same(r.aVerifier, ["energie", "puissance", "critair"]), "confiance mesurée : P.3GO (55) rend l'énergie douteuse, « 96 » (27) la puissance, et le Crit'Air suit l'énergie", r.aVerifier);
r = extraire(sortieTesseract, [{ texte: "P.66", confiance: 40 }, { texte: "S.15", confiance: 40 }]);
ok(same(r.aVerifier, ["cv", "places"]), "code collé P.66 / S.15 peu fiable : CV et places à vérifier", r.aVerifier);
r = extraire(propre, [{ texte: "VP", confiance: 10 }, { texte: "J.1", confiance: 10 }]);
ok(same(r.aVerifier, []), "un mot peu fiable qui ne sert à rien n'alerte pas", r.aVerifier);
r = extraire(["D1PEUGEOT", "D3 3008", "J.1VP", "J2AC", "P296", "P.3 EH", "P66", "S15"].join("\n"));
ok(r.champs.marque === "Peugeot" && r.champs.modele === "3008" && r.champs.carrosserie === "Break" && r.champs.puissance === 131 && r.champs.energie === "Hybride" && r.champs.cv === 6 && r.champs.places === 5, "D1PEUGEOT, J2AC, P296, P66, S15 en début de ligne", r.champs);
r = extraire("D.1 RENAULT\nD.3 S1 QUATTRO P66");
ok(r.champs.modele === "S1 Quattro P66" && !("cv" in r.champs), "collé et sans point en milieu de ligne : jamais pris pour un code", r.champs);
// Tesseract lit parfois la lettre du code en minuscule (observé : « s.15 »)
r = extraire(sortieTesseract.replace("S.15", "s.15").replace("P.3GO", "p.3GO").replace("D.1 PEUGEOT", "d.1 PEUGEOT").replace("J2AC", "j2 AC"));
ok(same(r.champs, extraire(propre).champs), "lettres de code en minuscules (s.15, p.3GO, d.1, j2)", r.champs);
r = extraire("a AB-123-CD\nb 15/03/2018\ne VF3MCYHZRJS120456");
ok(r.champs.immatriculation === "AB-123-CD" && r.champs.annee === 2018 && r.champs.vin === "VF3MCYHZRJS120456" && !r.aVerifier.length, "a, b, e en minuscules suivis d'une valeur de la bonne forme", r);
ok(same(extraire("il a le droit de b e a"), { champs: {}, aVerifier: [] }), "« a », « b », « e » dans une phrase : rien d'extrait");

section("VIN avec des O au lieu de 0");
r = extraire(avec({ "VF3MCYHZRJS120456": "VF3MCYHZRJS12O456" }));
ok(r.champs.vin === "VF3MCYHZRJS120456", "VIN corrigé", r.champs.vin);
ok(r.aVerifier.includes("vin") && r.aVerifier.length === 1, "VIN marqué « à vérifier »", r.aVerifier);
r = extraire(avec({ "VF3MCYHZRJS120456": "VF3MCYHZRJS12Q456" }));
ok(r.champs.vin === "VF3MCYHZRJS120456", "Q lu pour 0 corrigé aussi", r.champs.vin);
r = extraire(avec({ "VF3MCYHZRJS120456": "VF3 MCYHZ RJS120456" }));
ok(r.champs.vin === "VF3MCYHZRJS120456" && !r.aVerifier.includes("vin"), "VIN coupé par des espaces, rassemblé", r);
r = extraire(avec({ "VF3MCYHZRJS120456": "VF3MCYHZRJS12045" }));
ok(!("vin" in r.champs), "VIN de 16 caractères : non rempli", r.champs.vin);

section("Plaque");
r = extraire(avec({ "AB-123-CD": "AB 123 CD" }));
ok(r.champs.immatriculation === "AB-123-CD" && !r.aVerifier.includes("immatriculation"), "AB 123 CD → AB-123-CD", r);
r = extraire(avec({ "AB-123-CD": "AB-I23-CD" }));
ok(r.champs.immatriculation === "AB-123-CD" && r.aVerifier.includes("immatriculation"), "AB-I23-CD → AB-123-CD, à vérifier", r);
r = extraire(avec({ "AB-123-CD": "AB123CD" }));
ok(r.champs.immatriculation === "AB-123-CD" && !r.aVerifier.includes("immatriculation"), "AB123CD sans tirets", r);
r = extraire(avec({ "AB-123-CD": "AB-1O3-CD" }));
ok(r.champs.immatriculation === "AB-103-CD" && r.aVerifier.includes("immatriculation"), "O lu pour 0 dans les chiffres", r);
r = extraire(avec({ "AB-123-CD": "AB-123-C0" }));
ok(r.champs.immatriculation === "AB-123-CO" && r.aVerifier.includes("immatriculation"), "0 lu pour O dans les lettres", r);
r = extraire(avec({ "A AB-123-CD": "Plaque : AB-123-CD" }));
ok(r.champs.immatriculation === "AB-123-CD" && r.aVerifier.includes("immatriculation"), "code A illisible : plaque cherchée partout, à vérifier", r);

section("Puissance, énergie, carrosserie");
ok(extraire(avec({ "P.2 96": "P.2 96" })).champs.puissance === 131, "P.2 = 96 kW → 131 ch");
ok(extraire(avec({ "P.2 96": "P.2 96,5" })).champs.puissance === 131, "P.2 = 96,5 → 131 ch");
ok(extraire(avec({ "P.2 96": "P.2 5000" })).champs.puissance === undefined, "P.2 hors bornes (> 2 000 ch) : non rempli");
const energies = ["EH", "GO", "GP", "FE"].map((c) => extraire(avec({ "P.3 GO": "P.3 " + c })).champs.energie);
ok(same(energies, ["Hybride", "Diesel", "GPL", "Autre"]), "P.3 = EH, GO, GP, FE → Hybride, Diesel, GPL, Autre", energies);
const toutes = Object.fromEntries(["ES", "GO", "EL", "EE", "EH", "GL", "GH", "FL", "FH", "GP", "EG"].map((c) => [c, extraire(avec({ "P.3 GO": "P.3 " + c })).champs.energie]));
ok(same(toutes, { ES: "Essence", GO: "Diesel", EL: "Électrique", EE: "Hybride", EH: "Hybride", GL: "Hybride", GH: "Hybride", FL: "Hybride", FH: "Hybride", GP: "GPL", EG: "GPL" }), "table complète des codes P.3", toutes);
ok(extraire(avec({ "P.3 GO": "P.3 G0" })).aVerifier.includes("energie"), "G0 lu pour GO : corrigé, à vérifier");
r = extraire(avec({ "J.1 VP": "J.1 CTTE", "J.2 AC": "J.2 BB" }));
ok(r.champs.carrosserie === "Utilitaire", "J.1 = CTTE et J.2 = BB → Utilitaire", r.champs.carrosserie);
r = extraire(avec({ "J.1 VP": "J.1 CTTE" }));
ok(r.champs.carrosserie === "Utilitaire" && !r.aVerifier.includes("carrosserie"), "CTTE prioritaire sur J.2 = AC", r);
const carros = ["AA", "AB", "AC", "AD", "AE", "AF"].map((c) => { const x = extraire(avec({ "J.2 AC": "J.2 " + c })); return [x.champs.carrosserie, x.aVerifier.includes("carrosserie")]; });
ok(same(carros, [["Berline", false], ["Compacte", true], ["Break", false], ["Coupé", false], ["Cabriolet", false], ["Monospace", true]]), "J.2 : AB et AF « à vérifier », les autres non", carros);
ok(extraire(avec({ "J.2 AC": "J.2 ZZ" })).champs.carrosserie === undefined, "J.2 inconnu : non rempli");

section("Bornes du serveur : une valeur hors bornes n'est pas remplie");
r = extraire(avec({ "15/03/2018": "15/03/1899" }));
ok(r.champs.annee === undefined && r.champs.miseEnCirculation === undefined, "année 1899 : non rempli", r);
r = extraire(avec({ "15/03/2018": "15/03/" + (new Date().getFullYear() + 2) }));
ok(r.champs.annee === undefined && r.champs.miseEnCirculation === undefined, "année dans 2 ans : non rempli", r);
r = extraire(avec({ "15/03/2018": "15/03/" + (new Date().getFullYear() + 1) }));
ok(r.champs.annee === new Date().getFullYear() + 1 && !r.aVerifier.includes("annee"), "année de l'an prochain acceptée", r.champs.annee);
r = extraire(avec({ "15/03/2018": "15/03/1950" }));
ok(r.champs.annee === 1950, "année 1950 acceptée", r.champs.annee);
r = extraire(avec({ "15/03/2018": "31/02/2018" }));
ok(r.champs.annee === undefined && r.champs.miseEnCirculation === undefined, "31/02 impossible : non rempli", r);
ok(extraire(avec({ "P.6 6": "P.6 0" })).champs.cv === undefined, "CV 0 : non rempli");
ok(extraire(avec({ "P.6 6": "P.6 99" })).champs.cv === 99, "CV 99 accepté");
ok(extraire(avec({ "S.1 5": "S.1 0" })).champs.places === undefined, "places 0 : non rempli");
ok(extraire(avec({ "S.1 5": "S.1 12" })).champs.places === undefined, "places 12 : non rempli");
ok(extraire(avec({ "S.1 5": "S.1 9" })).champs.places === 9, "places 9 acceptées");

section("Titulaire : jamais extrait");
const avecTitulaire = "C.1 DUPONT JEAN\nC.3 12 RUE DES LILAS 63600 AMBERT\nC.4.1 PROPRIETAIRE\n" + propre;
r = extraire(avecTitulaire);
ok(!JSON.stringify(r).toUpperCase().includes("DUPONT"), "aucune valeur ne contient DUPONT", r);
ok(!/JEAN|LILAS|AMBERT|63600/i.test(JSON.stringify(r)), "ni le prénom, ni l'adresse", r);
ok(same(r.champs, extraire(propre).champs), "le reste est lu normalement", r.champs);
r = extraire("C.1 DUPONT JEAN");
ok(same(r, { champs: {}, aVerifier: [] }), "texte avec seulement C.1 : rien d'extrait", r);
r = extraire("C.1 DUPONT JEAN D.1 PEUGEOT D.3 3008");
ok(r.champs.marque === "Peugeot" && r.champs.modele === "3008" && !JSON.stringify(r).includes("DUPONT"), "C.1 et D.1 sur la même ligne", r);
r = extraire("C.1 DUPONT JEAN 15/03/1960\nA AB-123-CD");
ok(r.champs.immatriculation === "AB-123-CD" && !("annee" in r.champs), "une date dans la ligne du titulaire n'est pas prise pour la date B", r);

section("Texte vide ou illisible : aucun champ, aucune erreur");
for (const t of ["", "   \n\t ", null, undefined, 42, {}, "lorem ipsum dolor sit amet", "&é\"'(-è_çà)=", "A\nB\nE\nD.1\nD.3\nP.2\nP.3\nJ.2\nV.9", "D.1 \nD.3 \nP.2 \nS.1 "]) {
  let res, erreur = null;
  try { res = extraire(t); } catch (e) { erreur = e; }
  ok(!erreur && res && same(res, { champs: {}, aVerifier: [] }), "extraire(" + JSON.stringify(t) + ") → rien", erreur ? String(erreur) : res);
}
{
  let erreur = null, n = 0;
  const alphabet = "ABDEJPSV0123456789.,:/- \n|OIl";
  try {
    for (let i = 0; i < 3000; i++) {
      let s = "";
      for (let k = Math.floor(Math.random() * 120); k > 0; k--) s += alphabet[Math.floor(Math.random() * alphabet.length)];
      const x = extraire(s, [{ texte: s.slice(0, 5), confiance: 10 }]);
      if (!x || typeof x.champs !== "object" || !Array.isArray(x.aVerifier)) throw new Error("forme invalide");
      n++;
    }
  } catch (e) { erreur = e; }
  ok(!erreur && n === 3000, "3 000 textes au hasard : jamais d'erreur", erreur && String(erreur));
}

section("Recherches de secours (valeur sans son code → « à vérifier »)");
r = extraire("immatriculation AB-123-CD\nPremière immat. 15/03/2018\nVIN VF3MCYHZRJS120456\nNorme EURO 6\nP.3 GO");
ok(r.champs.immatriculation === "AB-123-CD" && r.aVerifier.includes("immatriculation"), "plaque trouvée sans le code A", r);
ok(r.champs.annee === 2018 && r.champs.miseEnCirculation === "03/2018" && r.aVerifier.includes("annee") && r.aVerifier.includes("miseEnCirculation"), "date : plus ancienne date du document", r);
ok(r.champs.vin === "VF3MCYHZRJS120456" && r.aVerifier.includes("vin"), "VIN trouvé sans le code E", r);
ok(r.champs.critair === 2 && r.aVerifier.includes("critair"), "Crit'Air calculé d'après une norme Euro trouvée sans V.9 : à vérifier", r);
r = extraire("12/05/2022\n03/09/2015\n20/01/2019");
ok(r.champs.annee === 2015 && r.champs.miseEnCirculation === "09/2015", "la plus ancienne des dates", r.champs);
r = extraire("PEUGEOT 3008 ADMINISTRATIVE SERVICES\nP.1 1499 P.2 96 P.3 GO P.6 6 S.1 5\nREFERENCE ABCDEFGHJKLMNPRST");
ok(!("vin" in r.champs), "un mot de 17 lettres n'est pas pris pour un VIN", r.champs.vin);
r = extraire("D.1 PEUGEOT\nP.1 1499 P.2 96 P.3 GO P.6 6 S.1 5");
ok(!("vin" in r.champs), "les rubriques voisines ne sont pas recollées en faux VIN", r.champs.vin);

section("Même ligne, plusieurs rubriques");
r = extraire("A AB-123-CD B 15/03/2018\nD.1 PEUGEOT D.3 3008\nP.2 96 P.3 GO P.6 6 S.1 5");
ok(r.champs.immatriculation === "AB-123-CD" && r.champs.annee === 2018 && !r.aVerifier.length, "A et B sur la même ligne", r);
ok(r.champs.marque === "Peugeot" && r.champs.modele === "3008", "D.1 et D.3 sur la même ligne", r.champs);
ok(r.champs.puissance === 131 && r.champs.energie === "Diesel" && r.champs.cv === 6 && r.champs.places === 5, "P.2, P.3, P.6, S.1 sur la même ligne", r.champs);
r = extraire("D1 PEUGEOT D3 3008");
ok(r.champs.marque === "Peugeot" && r.champs.modele === "3008", "D1 et D3 sans points sur la même ligne", r.champs);
r = extraire("D.3 S1 QUATTRO\nS.1 5");
ok(r.champs.modele === "S1 Quattro" && r.champs.places === 5, "« S1 » dans un modèle n'est pas le code S.1", r.champs);
r = extraire("D.1 CITROEN\nD.3 C3 AIRCROSS\nS.1 5");
ok(r.champs.modele === "C3 Aircross" && r.champs.places === 5, "« C3 » dans un modèle n'est pas le code C.3", r.champs);
r = extraire("D.1 TESLA\nD.3 ID.3");
ok(r.champs.modele === "ID.3", "ID.3 : le « D.3 » interne n'est pas un code", r.champs);

section("Marque et modèle : casse");
const marque = (m) => extraire("D.1 " + m).champs.marque;
const modele = (m) => extraire("D.3 " + m).champs.modele;
ok(marque("PEUGEOT") === "Peugeot", "PEUGEOT → Peugeot");
ok(marque("MERCEDES-BENZ") === "Mercedes-Benz", "MERCEDES-BENZ → Mercedes-Benz (tiret conservé)", marque("MERCEDES-BENZ"));
ok(["BMW", "DS", "MG", "BYD"].every((m) => marque(m) === m), "sigles BMW, DS, MG, BYD conservés");
ok(marque("ALFA ROMEO") === "Alfa Romeo", "ALFA ROMEO → Alfa Romeo");
ok(marque("CITROEN") === "Citroën" && marque("SKODA") === "Škoda", "CITROEN et SKODA : écriture du catalogue du site");
ok(marque("Renault") === "Renault", "déjà en minuscules");
ok(marque("  PEUGEOT  ") === "Peugeot" && marque("PEUGEOT ~|") === "Peugeot", "espaces et parasites retirés");
ok(modele("3008") === "3008" && modele("CLIO V") === "Clio V" && modele("SANDERO STEPWAY") === "Sandero Stepway", "modèles : chiffres et chiffres romains conservés", [modele("3008"), modele("CLIO V"), modele("SANDERO STEPWAY")]);
ok(modele("C3 AIRCROSS") === "C3 Aircross" && modele("308 SW") === "308 SW" && modele("GOLF GTI") === "Golf GTI", "C3, SW, GTI conservés", [modele("C3 AIRCROSS"), modele("308 SW"), modele("GOLF GTI")]);
ok(extraire("D.1 " + "X".repeat(200)).champs.marque.length === 80, "marque coupée à 80 caractères (limite du champ)");

section("Confiance Tesseract (mots fournis par lire)");
r = extraire(propre, [{ texte: "PEUGEOT", confiance: 41 }, { texte: "96", confiance: 55 }, { texte: "GO", confiance: 95 }]);
ok(r.aVerifier.includes("marque") && r.aVerifier.includes("puissance") && !r.aVerifier.includes("energie"), "mots sous 70 : valeurs à vérifier", r.aVerifier);
r = extraire(propre, [{ texte: "GO", confiance: 69 }]);
ok(r.aVerifier.includes("energie") && r.aVerifier.includes("critair"), "énergie douteuse : le Crit'Air qui en dépend l'est aussi", r.aVerifier);
r = extraire(propre, [{ texte: "GO", confiance: 70 }, { texte: "PEUGEOT", confiance: 99 }]);
ok(!r.aVerifier.length, "confiance de 70 et plus : rien à signaler", r.aVerifier);
r = extraire(propre, [{ texte: "EURO", confiance: 30 }, { texte: "6", confiance: 30 }]);
ok(r.aVerifier.includes("critair"), "norme Euro lue avec une faible confiance : Crit'Air à vérifier", r.aVerifier);
r = extraire(propre, null);
ok(!r.aVerifier.length, "sans mots (extraire seul) : aucune erreur", r.aVerifier);

section("Crit'Air : tableau de la spécification");
const t = (...a) => critair(...a);
ok(same([t("ES", 2012), t("ES", 2008), t("ES", 2003)], [1, 2, 3]), "ES 2012, 2008, 2003 → 1, 2, 3", [t("ES", 2012), t("ES", 2008), t("ES", 2003)]);
ok(same([t("GO", 2015), t("GO", 2008), t("GO", 2003), t("GO", 1999), t("GO", 1995)], [2, 3, 4, 5, null]), "GO 2015, 2008, 2003, 1999, 1995 → 2, 3, 4, 5, null", [t("GO", 2015), t("GO", 2008), t("GO", 2003), t("GO", 1999), t("GO", 1995)]);
ok(same([t("EL", 2020), t("EE", 2016), t("ES", 2009, "Euro 5")], [0, 1, 1]), "EL 0, EE 1, ES 2009 + Euro 5 → 1 (la norme prime sur la date)", [t("EL", 2020), t("EE", 2016), t("ES", 2009, "Euro 5")]);
ok(t("ES", 2009, 5) === 1 && t("ES", 2020, "EURO 4") === 2, "norme Euro en nombre ou en texte, toujours prioritaire");
ok(same([t("GO", null, 6), t("GO", null, 5), t("GO", null, 4), t("GO", null, 3), t("GO", null, 2), t("GO", null, 1)], [2, 2, 3, 4, 5, null]), "gazole : Euro 6 à 1", [t("GO", null, 6), t("GO", null, 3), t("GO", null, 2), t("GO", null, 1)]);
ok(same([t("ES", null, 6), t("ES", null, 4), t("ES", null, 3), t("ES", null, 2), t("ES", null, 1)], [1, 2, 3, 3, null]), "essence : Euro 6 à 1", [t("ES", null, 6), t("ES", null, 4), t("ES", null, 3), t("ES", null, 2), t("ES", null, 1)]);
ok(same([t("ES", 2011), t("ES", 2010), t("ES", 2006), t("ES", 2005), t("ES", 1997), t("ES", 1996)], [1, 2, 2, 3, 3, null]), "essence : bornes 2011 / 2006 / 1997", [t("ES", 2011), t("ES", 2010), t("ES", 2006), t("ES", 2005), t("ES", 1997), t("ES", 1996)]);
ok(same([t("GO", 2011), t("GO", 2010), t("GO", 2006), t("GO", 2005), t("GO", 2001), t("GO", 2000), t("GO", 1997), t("GO", 1996)], [2, 3, 3, 4, 4, 5, 5, null]), "gazole : bornes 2011 / 2006 / 2001 / 1997", [t("GO", 2011), t("GO", 2010), t("GO", 2006), t("GO", 2005), t("GO", 2001), t("GO", 2000), t("GO", 1997), t("GO", 1996)]);
ok(same([t("GP", 2005), t("EG", 2005), t("GN", 2005), t("GL", 2005), t("EE", 2005), t("H2", 2005)], [1, 1, 1, 1, 1, 0]), "gaz et hybrides rechargeables : 1, hydrogène : 0, toutes dates");
ok(same([t("EH", 2015), t("EH", 2008), t("GH", 2015), t("GH", 2008)], [1, 2, 2, 3]), "hybrides non rechargeables : règle de leur carburant", [t("EH", 2015), t("EH", 2008), t("GH", 2015), t("GH", 2008)]);
ok(t("GH", 2003) === null && t("GH", null, 3) === null, "GH avant Euro 4 : non classé (la spécification ne prévoit que le gazole pur)");
ok(t("EL") === 0 && t("EL", null, null) === 0, "électrique : 0 même sans date");
ok(t("ES") === null && t("ES", null, null) === null && t("ES", "n'importe quoi") === null, "ni date ni norme : null");
ok(t("XX", 2020) === null && t("FE", 2020) === null && t("FL", 2020) === null && t("", 2020) === null && t(undefined, 2020) === null, "énergie sans règle : null (champ laissé vide)");
ok(t("es", 2012) === 1, "code en minuscules");
ok(t("ES", "03/2012") === 1 && t("ES", "15/03/2008") === 2 && t("GO", new Date(2003, 5, 1)) === 4, "date en « MM/AAAA », « JJ/MM/AAAA » ou Date");

section("Crit'Air dans extraire() : voitures et utilitaires");
r = extraire(avec({ "V.9 EURO 6": "V.9 EURO 4" }));
ok(r.champs.critair === 3, "gazole Euro 4 → 3", r.champs.critair);
r = extraire(avec({ "V.9 EURO 6\n": "", "P.3 GO": "P.3 ES" }).replace("V.9 EURO 6", ""));
ok(r.champs.critair === 1 && !r.aVerifier.includes("critair"), "sans V.9 : date B (2018, essence) → 1, rien à signaler", r);
r = extraire(propre.replace("V.9 EURO 6", "").replace("B 15/03/2018", "B 15/03/2008"));
ok(r.champs.critair === 3 && r.champs.annee === 2008, "sans V.9 : date B (2008, gazole) → 3", r.champs);
r = extraire(avec({ "J.1 VP": "J.1 CTTE" }).replace("V.9 EURO 6", ""));
ok(!("critair" in r.champs) && r.aVerifier.includes("critair"), "utilitaire sans norme Euro : Crit'Air vide et « à vérifier »", r);
r = extraire(avec({ "J.1 VP": "J.1 CTTE" }));
ok(r.champs.critair === 2 && !r.aVerifier.includes("critair"), "utilitaire avec norme Euro 6 : Crit'Air 2", r);
r = extraire(propre.replace("P.3 GO", "P.3 FE"));
ok(!("critair" in r.champs) && !r.aVerifier.includes("critair"), "énergie sans règle : Crit'Air vide, sans alerte", r);
r = extraire(propre.replace("P.3 GO", "P.3 EL"));
ok(r.champs.critair === 0 && r.champs.energie === "Électrique", "électrique : Crit'Air 0", r.champs);
r = extraire(propre.replace("V.9 EURO 6", "V.9 EURO 1"));
ok(!("critair" in r.champs), "Euro 1 : non classé, champ laissé vide", r.champs.critair);

console.log(`\n${passes} réussis, ${failures} échoués`);
process.exit(failures ? 1 : 0);
