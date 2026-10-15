/* ==========================================================================
   Livradois Automobiles — stock de véhicules
   --------------------------------------------------------------------------
   Pour ajouter / modifier un véhicule, éditez simplement la liste ci-dessous.
   - id          : identifiant unique utilisé dans l'adresse (vehicule.html?id=...)
   - statut      : "disponible" | "reserve" | "vendu" (les véhicules vendus sont masqués)
   - prixBarre   : ancien prix (optionnel) -> affiche le badge « Prix en baisse »
   - badge       : étiquette libre (optionnel), ex. "Coup de cœur"
   - ajoutLe     : date d'arrivée (AAAA-MM-JJ) -> badge « Nouveauté » pendant 10 jours
   - photos      : fichiers dans public/assets/vehicules/ (sans extension).
                   Chaque photo existe en deux tailles : NOM.webp (1200x800) et NOM-sm.webp (600x400).
                   credit/licence/source : à renseigner si la photo n'est pas la vôtre.
   ========================================================================== */
window.VEHICULES = [
  {
    id: "suzuki-jimny-2020", ref: "LA-2417", statut: "disponible", marque: "Suzuki", modele: "Jimny", version: "1.5 VVT 102 Pack 4x4",
    annee: 2020, miseEnCirculation: "06/2020", km: 42800,
    energie: "Essence", boite: "Manuelle", carrosserie: "4x4",
    puissance: 102, cv: 7, portes: 3, places: 4,
    couleur: "Bleu Kinetic", critair: 1, premiereMain: true, quatreRoues: true,
    garantie: 12, prix: 24990, prixBarre: null, badge: "Coup de cœur", ajoutLe: "2026-10-14",
    photos: [
      { fichier: "suzuki-jimny-2", credit: "Vauxford", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:2019_Suzuki_Jimny_SZ5_4X4_Automatic_1.5_Front.jpg" },
      { fichier: "suzuki-jimny-1", credit: "Vauxford", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:2019_Suzuki_Jimny_SZ5_4X4_Automatic_1.5_Rear.jpg" },
      { fichier: "suzuki-jimny-3", credit: "Vauxford", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:2019_Suzuki_Jimny_SZ5_4X4_Automatic_1.5_(1).jpg" }
    ],
    equipements: [
      "4 roues motrices enclenchables",
      "Réducteur de gamme",
      "Aide au démarrage en côte",
      "Aide à la descente",
      "Écran tactile 7\" avec GPS",
      "Apple CarPlay / Android Auto",
      "Climatisation automatique",
      "Sièges avant chauffants",
      "Jantes alliage 15\"",
      "Phares LED",
      "Freinage d'urgence automatique",
      "Régulateur de vitesse"
    ],
    description: "Le petit franchisseur par excellence, idéal pour les routes du Livradois et les hivers auvergnats. Véhicule en très bon état, entretien suivi, pneumatiques récents. Un modèle très recherché en occasion : n'attendez pas pour venir l'essayer."
  },
  {
    id: "peugeot-2008-2023", ref: "LA-2416", statut: "disponible", marque: "Peugeot", modele: "2008", version: "1.2 PureTech 130 EAT8 GT",
    annee: 2023, miseEnCirculation: "09/2023", km: 18900,
    energie: "Essence", boite: "Automatique", carrosserie: "SUV",
    puissance: 130, cv: 7, portes: 5, places: 5,
    couleur: "Rouge Elixir", critair: 1, premiereMain: true, quatreRoues: false,
    garantie: 12, prix: 24900, prixBarre: null, badge: null, ajoutLe: "2026-10-12",
    photos: [
      { fichier: "peugeot-2008-1", credit: "Alexander-93", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Peugeot_2008_B_Facelift_IMG_1185.jpg" },
      { fichier: "peugeot-2008-2", credit: "Alexander-93", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Peugeot_2008_B_Facelift_IMG_1180.jpg" }
    ],
    equipements: [
      "i-Cockpit numérique 3D",
      "Écran tactile 10\" avec GPS connecté",
      "Apple CarPlay / Android Auto sans fil",
      "Caméra de recul",
      "Radars de stationnement avant et arrière",
      "Climatisation automatique",
      "Projecteurs Full LED",
      "Jantes alliage 17\"",
      "Recharge smartphone par induction",
      "Aide au maintien dans la voie",
      "Freinage d'urgence automatique",
      "Lecture des panneaux"
    ],
    description: "SUV urbain récent dans sa finition haut de gamme GT, avec boîte automatique 8 rapports. Faible kilométrage, première main, carnet d'entretien à jour. Un véhicule quasi neuf à prix d'occasion."
  },
  {
    id: "peugeot-208-2021", ref: "LA-2415", statut: "disponible", marque: "Peugeot", modele: "208", version: "1.2 PureTech 100 S&S GT Line",
    annee: 2021, miseEnCirculation: "03/2021", km: 38200,
    energie: "Essence", boite: "Manuelle", carrosserie: "Citadine",
    puissance: 100, cv: 5, portes: 5, places: 5,
    couleur: "Rouge Elixir", critair: 1, premiereMain: true, quatreRoues: false,
    garantie: 12, prix: 16490, prixBarre: null, badge: null, ajoutLe: "2026-10-10",
    photos: [
      { fichier: "peugeot-208-1", credit: "Futurhit12", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Peugeot_208_II_GT_Line_rouge_(avant).jpg" },
      { fichier: "peugeot-208-2", credit: "Futurhit12", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Peugeot_208_II_GT_Line_rouge_(arri%C3%A8re).jpg" }
    ],
    equipements: [
      "i-Cockpit 3D",
      "Écran tactile 10\"",
      "Apple CarPlay / Android Auto",
      "Caméra de recul",
      "Radars de recul",
      "Climatisation automatique",
      "Projecteurs Full LED",
      "Jantes alliage 17\"",
      "Régulateur / limiteur de vitesse",
      "Freinage d'urgence automatique",
      "Aide au maintien dans la voie",
      "Ciel de toit noir"
    ],
    description: "Citadine moderne et économique, parfaite pour un premier véhicule ou un usage quotidien. Finition GT Line sportive, première main, entretien constructeur suivi."
  },
  {
    id: "volkswagen-t-roc-2022", ref: "LA-2414", statut: "disponible", marque: "Volkswagen", modele: "T-Roc", version: "1.5 TSI 150 DSG7 R-Line",
    annee: 2022, miseEnCirculation: "05/2022", km: 27400,
    energie: "Essence", boite: "Automatique", carrosserie: "SUV",
    puissance: 150, cv: 8, portes: 5, places: 5,
    couleur: "Blanc Pur, toit noir", critair: 1, premiereMain: true, quatreRoues: false,
    garantie: 12, prix: 27490, prixBarre: null, badge: null, ajoutLe: "2026-10-08",
    photos: [
      { fichier: "volkswagen-t-roc-1", credit: "M 93", licence: "CC BY-SA 3.0 de", source: "https://commons.wikimedia.org/wiki/File:VW_T-Roc_R-Line_(Facelift)_%E2%80%93_f_22022025.jpg" },
      { fichier: "volkswagen-t-roc-2", credit: "M 93", licence: "CC BY-SA 3.0 de", source: "https://commons.wikimedia.org/wiki/File:VW_T-Roc_R-Line_(Facelift)_%E2%80%93_h_22022025.jpg" }
    ],
    equipements: [
      "Digital Cockpit Pro",
      "GPS Discover Media",
      "App-Connect sans fil",
      "Caméra de recul",
      "Park Distance Control AV/AR",
      "Climatisation automatique bi-zone",
      "Phares IQ.Light LED",
      "Jantes alliage 18\"",
      "Sièges sport R-Line",
      "Régulateur adaptatif ACC",
      "Accès et démarrage sans clé",
      "Hayon électrique"
    ],
    description: "SUV compact au look affirmé en finition R-Line, boîte DSG7 douce et réactive. Très faible kilométrage, véhicule révisé et contrôlé dans notre atelier avant la vente."
  },
  {
    id: "renault-captur-2022", ref: "LA-2413", statut: "disponible", marque: "Renault", modele: "Captur", version: "E-Tech Full Hybrid 145 Intens",
    annee: 2022, miseEnCirculation: "02/2022", km: 29800,
    energie: "Hybride", boite: "Automatique", carrosserie: "SUV",
    puissance: 143, cv: 5, portes: 5, places: 5,
    couleur: "Rouge Flamme, toit noir", critair: 1, premiereMain: false, quatreRoues: false,
    garantie: 12, prix: 21490, prixBarre: null, badge: null, ajoutLe: "2026-10-05",
    photos: [
      { fichier: "renault-captur-1", credit: "Alexander Migl", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Renault_Captur_II_E-Tech_IMG_3336.jpg" },
      { fichier: "renault-captur-2", credit: "Iswoar", licence: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:Renault_Captur_II_Seitenansicht.JPG" }
    ],
    equipements: [
      "Hybride auto-rechargeable",
      "Écran Easy Link 9,3\" avec GPS",
      "Apple CarPlay / Android Auto",
      "Caméra de recul",
      "Radars avant et arrière",
      "Climatisation automatique",
      "Banquette arrière coulissante",
      "Jantes alliage 18\"",
      "Carte mains-libres",
      "Freinage d'urgence automatique",
      "Alerte de franchissement de ligne"
    ],
    description: "SUV hybride sobre et silencieux en ville, sans contrainte de recharge. Consommation réduite et vignette Crit'Air 1. Révision complète effectuée."
  },
  {
    id: "tesla-model-3-2021", ref: "LA-2412", statut: "disponible", marque: "Tesla", modele: "Model 3", version: "Standard Plus Propulsion",
    annee: 2021, miseEnCirculation: "04/2021", km: 64000,
    energie: "Électrique", boite: "Automatique", carrosserie: "Berline",
    puissance: 283, cv: 3, portes: 4, places: 5,
    couleur: "Rouge Multicouches", critair: 0, premiereMain: true, quatreRoues: false,
    autonomie: 448,
    garantie: 12, prix: 26900, prixBarre: null, badge: null, ajoutLe: "2026-10-01",
    photos: [
      { fichier: "tesla-model-3-1", credit: "Elise240SX", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:2019_Tesla_Model_3_Long_Range_Dual_Motor_in_Red_Multi-Coat,_front_left,_2021-05-30.jpg" }
    ],
    equipements: [
      "Autopilot",
      "Écran tactile central 15\"",
      "GPS avec planificateur de recharge",
      "Toit en verre panoramique",
      "Sièges avant chauffants",
      "Caméras 360°",
      "Climatisation automatique bi-zone",
      "Accès par smartphone",
      "Jantes Aero 18\"",
      "Câble de recharge fourni"
    ],
    description: "Berline 100 % électrique, autonomie WLTP annoncée de 448 km. Batterie contrôlée, mises à jour logicielles à distance. Coût d'usage très faible au quotidien."
  },
  {
    id: "peugeot-3008-2020", ref: "LA-2411", statut: "disponible", marque: "Peugeot", modele: "3008", version: "1.5 BlueHDi 130 S&S EAT8 GT Line",
    annee: 2020, miseEnCirculation: "07/2020", km: 72400,
    energie: "Diesel", boite: "Automatique", carrosserie: "SUV",
    puissance: 130, cv: 7, portes: 5, places: 5,
    couleur: "Blanc Nacré", critair: 2, premiereMain: false, quatreRoues: false,
    garantie: 12, prix: 22990, prixBarre: 23990, badge: null, ajoutLe: "2026-09-28",
    photos: [
      { fichier: "peugeot-3008-1", credit: "M 93", licence: "CC BY-SA 3.0 de", source: "https://commons.wikimedia.org/wiki/File:Peugeot_3008_THP_165_EAT6_Allure_GT-Line_(II)_%E2%80%93_Frontansicht,_20._September_2017,_D%C3%BCsseldorf.jpg" },
      { fichier: "peugeot-3008-2", credit: "M 93", licence: "CC BY-SA 3.0 de", source: "https://commons.wikimedia.org/wiki/File:Peugeot_3008_THP_165_EAT6_Allure_GT-Line_(II)_%E2%80%93_Heckansicht,_20._September_2017,_D%C3%BCsseldorf.jpg" },
      { fichier: "peugeot-3008-3", credit: "M 93", licence: "CC BY-SA 3.0 de", source: "https://commons.wikimedia.org/wiki/File:Peugeot_3008_THP_165_EAT6_Allure_GT-Line_(II)_%E2%80%93_Innenraum,_20._September_2017,_D%C3%BCsseldorf.jpg" }
    ],
    equipements: [
      "i-Cockpit 12,3\"",
      "GPS 3D connecté",
      "Apple CarPlay / Android Auto",
      "Caméra de recul 180°",
      "Radars avant et arrière",
      "Climatisation automatique bi-zone",
      "Projecteurs Full LED",
      "Jantes alliage 18\"",
      "Hayon électrique",
      "Accès et démarrage mains-libres",
      "Régulateur adaptatif",
      "Surveillance d'angles morts"
    ],
    description: "SUV familial spacieux et confortable, boîte automatique EAT8. Idéal pour les longs trajets. Distribution contrôlée, entretien à jour, deux clés."
  },
  {
    id: "toyota-yaris-cross-2021", ref: "LA-2410", statut: "disponible", marque: "Toyota", modele: "Yaris Cross", version: "Hybride 116h Design",
    annee: 2021, miseEnCirculation: "10/2021", km: 36200,
    energie: "Hybride", boite: "Automatique", carrosserie: "SUV",
    puissance: 116, cv: 4, portes: 5, places: 5,
    couleur: "Blanc Pur", critair: 1, premiereMain: true, quatreRoues: false,
    garantie: 12, prix: 21990, prixBarre: null, badge: null, ajoutLe: "2026-09-25",
    photos: [
      { fichier: "toyota-yaris-cross-1", credit: "Alexander-93", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Toyota_Yaris_Cross_Hybrid_(XP210)_1X7A1846.jpg" },
      { fichier: "toyota-yaris-cross-2", credit: "Alexander-93", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Toyota_Yaris_Cross_Hybrid_(XP210)_1X7A1848.jpg" }
    ],
    equipements: [
      "Motorisation hybride auto-rechargeable",
      "Écran tactile 8\"",
      "Apple CarPlay / Android Auto",
      "Caméra de recul",
      "Climatisation automatique",
      "Toyota Safety Sense",
      "Régulateur adaptatif",
      "Feux de route automatiques",
      "Jantes alliage 17\"",
      "Volant chauffant"
    ],
    description: "Petit SUV hybride réputé pour sa fiabilité et sa sobriété exemplaire. Première main, entretien suivi. Parfait compromis entre ville et route."
  },
  {
    id: "dacia-duster-2021", ref: "LA-2409", statut: "disponible", marque: "Dacia", modele: "Duster", version: "1.5 Blue dCi 115 4x4 Prestige",
    annee: 2021, miseEnCirculation: "11/2021", km: 54300,
    energie: "Diesel", boite: "Manuelle", carrosserie: "SUV",
    puissance: 115, cv: 6, portes: 5, places: 5,
    couleur: "Orange Arizona", critair: 2, premiereMain: true, quatreRoues: true,
    garantie: 12, prix: 18490, prixBarre: null, badge: null, ajoutLe: "2026-09-20",
    photos: [
      { fichier: "dacia-duster-1", credit: "Alexander Migl", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Dacia_Duster_II_IMG_4397.jpg" },
      { fichier: "dacia-duster-2", credit: "Alexander Migl", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Dacia_Duster_II_IMG_4398.jpg" }
    ],
    equipements: [
      "Transmission 4x4",
      "Aide à la descente",
      "Écran Media Nav 8\" avec GPS",
      "Apple CarPlay / Android Auto",
      "Caméra multivue",
      "Climatisation automatique",
      "Carte mains-libres",
      "Barres de toit",
      "Jantes alliage 17\"",
      "Surveillance d'angles morts"
    ],
    description: "Le SUV 4x4 robuste et économique, taillé pour nos routes de campagne et de montagne. Première main, faible consommation, entretien réalisé dans notre garage."
  },
  {
    id: "renault-clio-2021", ref: "LA-2408", statut: "disponible", marque: "Renault", modele: "Clio", version: "TCe 100 Intens",
    annee: 2021, miseEnCirculation: "01/2021", km: 41500,
    energie: "Essence", boite: "Manuelle", carrosserie: "Citadine",
    puissance: 100, cv: 5, portes: 5, places: 5,
    couleur: "Bleu Céladon", critair: 1, premiereMain: true, quatreRoues: false,
    garantie: 12, prix: 13990, prixBarre: null, badge: null, ajoutLe: "2026-09-15",
    photos: [
      { fichier: "renault-clio-1", credit: "M 93", licence: "CC BY-SA 3.0 de", source: "https://commons.wikimedia.org/wiki/File:Renault_Clio_TCe_100_Experience_(V)_%E2%80%93_f_09022020.jpg" },
      { fichier: "renault-clio-2", credit: "M 93", licence: "CC BY-SA 3.0 de", source: "https://commons.wikimedia.org/wiki/File:Renault_Clio_TCe_100_Experience_(V)_%E2%80%93_h_09022020.jpg" }
    ],
    equipements: [
      "Écran Easy Link 9,3\" avec GPS",
      "Apple CarPlay / Android Auto",
      "Caméra de recul",
      "Radars de recul",
      "Climatisation automatique",
      "Projecteurs Full LED",
      "Jantes alliage 16\"",
      "Carte mains-libres",
      "Freinage d'urgence automatique",
      "Régulateur / limiteur de vitesse"
    ],
    description: "La citadine la plus vendue de France dans sa finition la mieux équipée. Économique, agréable à conduire et facile à garer. Première main."
  },
  {
    id: "bmw-serie-3-touring-2022", ref: "LA-2407", statut: "disponible", marque: "BMW", modele: "Série 3 Touring", version: "320d xDrive 190 BVA8 M Sport",
    annee: 2022, miseEnCirculation: "08/2022", km: 58900,
    energie: "Diesel", boite: "Automatique", carrosserie: "Break",
    puissance: 190, cv: 10, portes: 5, places: 5,
    couleur: "Gris Argent métallisé", critair: 2, premiereMain: true, quatreRoues: true,
    garantie: 12, prix: 34900, prixBarre: null, badge: null, ajoutLe: "2026-09-12",
    photos: [
      { fichier: "bmw-serie-3-touring-1", credit: "Alexander Migl", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:BMW_G21_(2022)_DSC_2962.jpg" },
      { fichier: "bmw-serie-3-touring-2", credit: "Alexander Migl", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:BMW_G21_(2022)_1X7A6005.jpg" }
    ],
    equipements: [
      "Transmission intégrale xDrive",
      "BMW Live Cockpit Professional",
      "GPS avec écran 14,9\"",
      "Caméra de recul",
      "Park Assistant",
      "Climatisation automatique tri-zone",
      "Phares LED adaptatifs",
      "Sièges sport chauffants",
      "Hayon électrique",
      "Jantes alliage 18\" M",
      "Régulateur adaptatif",
      "Volant M cuir"
    ],
    description: "Break premium polyvalent : transmission intégrale xDrive, coffre généreux et finition M Sport. Historique d'entretien complet, véhicule de première main."
  },
  {
    id: "volkswagen-golf-2020", ref: "LA-2406", statut: "disponible", marque: "Volkswagen", modele: "Golf", version: "1.5 eTSI 150 DSG7 Life",
    annee: 2020, miseEnCirculation: "12/2020", km: 61000,
    energie: "Essence", boite: "Automatique", carrosserie: "Compacte",
    puissance: 150, cv: 8, portes: 5, places: 5,
    couleur: "Gris Argent", critair: 1, premiereMain: false, quatreRoues: false,
    garantie: 12, prix: 21990, prixBarre: null, badge: null, ajoutLe: "2026-09-05",
    photos: [
      { fichier: "volkswagen-golf-1", credit: "Vauxford", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:2020_Volkswagen_Golf_Style_1.5_Front.jpg" },
      { fichier: "volkswagen-golf-2", credit: "Vauxford", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:2020_Volkswagen_Golf_Style_1.5_Rear.jpg" },
      { fichier: "volkswagen-golf-3", credit: "Vauxford", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:2020_Volkswagen_Golf_Style_1.5_Side.jpg" }
    ],
    equipements: [
      "Digital Cockpit",
      "Écran tactile 10\" avec GPS",
      "App-Connect sans fil",
      "Climatisation automatique bi-zone",
      "Régulateur adaptatif ACC",
      "Aide au maintien dans la voie",
      "Phares LED",
      "Jantes alliage 16\"",
      "Accès sans clé",
      "Recharge par induction"
    ],
    description: "La référence des compactes, en motorisation micro-hybride eTSI et boîte DSG7. Confortable, sobre et très bien équipée."
  },
  {
    id: "citroen-c3-2021", ref: "LA-2405", statut: "disponible", marque: "Citroën", modele: "C3", version: "PureTech 83 S&S Shine",
    annee: 2021, miseEnCirculation: "06/2021", km: 33700,
    energie: "Essence", boite: "Manuelle", carrosserie: "Citadine",
    puissance: 83, cv: 4, portes: 5, places: 5,
    couleur: "Sable, toit noir", critair: 1, premiereMain: true, quatreRoues: false,
    garantie: 12, prix: 11990, prixBarre: null, badge: "Idéal jeune conducteur", ajoutLe: "2026-08-30",
    photos: [
      { fichier: "citroen-c3-1", credit: "Alexander Migl", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Citroen_C3_(3rd_generation)_Facelift_Auto_Zuerich_2021_IMG_0026.jpg" },
      { fichier: "citroen-c3-2", credit: "Alexander Migl", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Citroen_C3_(3rd_generation)_Facelift_Auto_Zuerich_2021_IMG_0027.jpg" }
    ],
    equipements: [
      "Écran tactile 7\" avec GPS",
      "Apple CarPlay / Android Auto",
      "Caméra de recul",
      "Climatisation automatique",
      "Airbump",
      "Régulateur / limiteur de vitesse",
      "Jantes alliage 16\"",
      "Aide au démarrage en côte"
    ],
    description: "Citadine confortable au style unique, faible puissance fiscale et assurance réduite : le choix idéal pour un jeune conducteur."
  },
  {
    id: "mercedes-classe-a-2019", ref: "LA-2404", statut: "disponible", marque: "Mercedes-Benz", modele: "Classe A", version: "A 180 d 7G-DCT Progressive Line",
    annee: 2019, miseEnCirculation: "09/2019", km: 79800,
    energie: "Diesel", boite: "Automatique", carrosserie: "Compacte",
    puissance: 116, cv: 6, portes: 5, places: 5,
    couleur: "Blanc Polaire", critair: 2, premiereMain: false, quatreRoues: false,
    garantie: 12, prix: 20490, prixBarre: 21490, badge: null, ajoutLe: "2026-08-20",
    photos: [
      { fichier: "mercedes-classe-a-1", credit: "Dinkun Chen", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:MERCEDES-BENZ_A-CLASS_(W177)_China.jpg" },
      { fichier: "mercedes-classe-a-2", credit: "Dinkun Chen", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:MERCEDES-BENZ_A-CLASS_(W177)_China_(2).jpg" }
    ],
    equipements: [
      "Système MBUX avec double écran",
      "GPS",
      "Apple CarPlay / Android Auto",
      "Caméra de recul",
      "Climatisation automatique",
      "Éclairage d'ambiance",
      "Projecteurs LED",
      "Jantes alliage 17\"",
      "Freinage d'urgence actif",
      "Régulateur de vitesse"
    ],
    description: "Compacte premium à l’intérieur raffiné et technologique. Boîte automatique à double embrayage, consommation maîtrisée. Révision complète effectuée."
  },
  {
    id: "skoda-octavia-combi-2021", ref: "LA-2403", statut: "disponible", marque: "Škoda", modele: "Octavia Combi", version: "2.0 TDI 150 DSG7 Style",
    annee: 2021, miseEnCirculation: "04/2021", km: 88300,
    energie: "Diesel", boite: "Automatique", carrosserie: "Break",
    puissance: 150, cv: 8, portes: 5, places: 5,
    couleur: "Rouge Velours", critair: 2, premiereMain: true, quatreRoues: false,
    garantie: 12, prix: 22490, prixBarre: null, badge: null, ajoutLe: "2026-08-10",
    photos: [
      { fichier: "skoda-octavia-combi-1", credit: "Alexander Migl", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Skoda_Octavia_IV_Combi_RS_1X7A0352.jpg" },
      { fichier: "skoda-octavia-combi-2", credit: "Alexander Migl", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Skoda_Octavia_IV_Combi_1X7A0209.jpg" }
    ],
    equipements: [
      "Virtual Cockpit",
      "GPS Columbus 10\"",
      "SmartLink sans fil",
      "Caméra de recul",
      "Radars avant et arrière",
      "Climatisation automatique tri-zone",
      "Phares Full LED Matrix",
      "Hayon électrique",
      "Sièges chauffants",
      "Jantes alliage 17\"",
      "Régulateur adaptatif"
    ],
    description: "Break familial au coffre immense (640 L), très bien équipé et économique sur long trajet. Idéal pour les familles et les grands rouleurs."
  },
  {
    id: "citroen-berlingo-van-2019", ref: "LA-2402", statut: "disponible", marque: "Citroën", modele: "Berlingo Van", version: "M 1.5 BlueHDi 100 S&S Club",
    annee: 2019, miseEnCirculation: "05/2019", km: 98500,
    energie: "Diesel", boite: "Manuelle", carrosserie: "Utilitaire",
    puissance: 100, cv: 5, portes: 4, places: 3,
    couleur: "Gris Acier", critair: 2, premiereMain: true, quatreRoues: false,
    garantie: 6, prix: 13900, prixBarre: null, badge: "TVA récupérable", ajoutLe: "2026-07-30",
    photos: [
      { fichier: "citroen-berlingo-van-1", credit: "Carfanatic2019", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:2019_Citroen_Berlingo_950_En-Prise_BHDI_SS_(MW68_YJY).jpg" }
    ],
    equipements: [
      "3 places avant",
      "Cloison de séparation",
      "Porte latérale coulissante",
      "Portes arrière battantes",
      "Climatisation",
      "Radio Bluetooth",
      "Régulateur / limiteur de vitesse",
      "Radars de recul",
      "Crochets d'arrimage"
    ],
    description: "Utilitaire compact fiable, volume utile de 3,3 m³. Parfait pour artisans et professionnels. Entretien suivi, distribution contrôlée."
  },
  {
    id: "fiat-500-2019", ref: "LA-2401", statut: "reserve", marque: "Fiat", modele: "500", version: "1.2 69 ch Lounge",
    annee: 2019, miseEnCirculation: "05/2019", km: 47600,
    energie: "Essence", boite: "Manuelle", carrosserie: "Citadine",
    puissance: 69, cv: 4, portes: 3, places: 4,
    couleur: "Bleu Pastel", critair: 1, premiereMain: false, quatreRoues: false,
    garantie: 12, prix: 10490, prixBarre: null, badge: null, ajoutLe: "2026-07-25",
    photos: [
      { fichier: "fiat-500-1", credit: "crash71100", licence: "CC0", source: "https://commons.wikimedia.org/wiki/File:Fiat_500_Spiaggina_58_(48565227297).jpg" },
      { fichier: "fiat-500-2", credit: "Petar Milošević", licence: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Fiat_500_dashboard_(white).jpg" }
    ],
    equipements: [
      "Écran Uconnect 7\"",
      "Apple CarPlay / Android Auto",
      "Climatisation",
      "Radars de recul",
      "Régulateur de vitesse",
      "Jantes alliage 15\"",
      "Toit vitré fixe"
    ],
    description: "L'iconique citadine italienne, idéale en ville. Coloris pastel très recherché. Ce véhicule est actuellement réservé."
  }
];
