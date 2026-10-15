/**
 * Rhyme-friendly French vocabulary (common in rap / urban pop lyrics) used by
 * the offline rhyme dictionary. Combined with the artist's own vocabulary, it
 * gives instant, free rhyme suggestions; the AI assistant adds contextual ones.
 */
export const RHYME_VOCAB = `
nuit bruit fuit conduit produit détruit réduit circuit minuit ennui appui fruit lui pluie suie
vie envie survie folie mélodie maladie copie partie sortie ortie amie nostalgie énergie magie
ville fil file style exil fragile tranquille difficile utile inutile habile asile facile débile
béton raison horizon prison maison saison poison frisson son néon démon pardon million vision
mission passion ambition condition tradition position illusion confusion addiction direction
tête fête quête bête planète trompette tempête défaite conquête silhouette cigarette disquette
argent temps vent sang enfant parent instant moment tourment serment néant géant vivant brûlant
rue tordue vue perdue déçue connue inconnue battue venue avenue tenue statue issue cohue
cœur peur douleur malheur bonheur rancœur sueur rumeur chaleur couleur valeur honneur vainqueur
nuage visage rage cage page sage image orage mirage passage voyage message courage virage
ciel miel fiel réel ruisseau oiseau château bateau cerveau couteau niveau bureau ghetto tempo
zone trône couronne personne automne aumône icône madone sonne donne pardonne abandonne
gloire mémoire histoire victoire noire espoir miroir trottoir couloir soir pouvoir savoir devoir
monde ronde onde seconde blonde profonde sonde gronde fronde abonde féconde vagabonde
haine chaîne peine veine reine scène arène graine semaine fontaine capitaine lointaine
flamme âme drame lame dame larme arme alarme charme vacarme gendarme vague bague dague
frère mère père colère misère lumière poussière prière barrière carrière hiver enfer fer mer
cash flash clash trash crash bling king ring game flame drame swing bang gang
quartier métier papier sentier acier chantier escalier dernier premier prisonnier guerrier
bitume lune plume brume rhume fortune rancune tribune lacune commune chacune aucune
rêve trêve sève élève grève lève glaive
fusil outil péril exil profil avril
loi roi foi soie joie proie voie froid droit doigt endroit étroit
bloc roc choc rock stock froc toc
banlieue lieue bleue queue feu jeu peu dieu lieu adieu milieu yeux vieux mieux sérieux heureux
chemin demain main destin festin matin chagrin requin parfum défunt importun commun
noir couloir espoir dortoir trottoir mouchoir
été passé tracé brisé usé osé pressé blessé glacé cassé laissé dépassé
vrai frais mais jamais paix palais secret regret projet objet sujet billet reflet complet
or corps mort fort sort port décor record effort dehors trésor accord remords
fou cou trou loup coup doux sous bout tout partout debout genou bijou caillou
plaisir désir sourire empire délire avenir souvenir martyr navire soupir
mal bal val signal final banal fatal brutal métal cristal journal capital idéal
tard bar car regard hasard retard cafard brouillard dollar radar rempart départ standard
`.split(/\s+/).filter(Boolean);
