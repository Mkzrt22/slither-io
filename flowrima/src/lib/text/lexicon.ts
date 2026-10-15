/**
 * Small lexicons used by the text engine. Kept deliberately compact: they only
 * need to cover the words that the rule-based heuristics get wrong, plus
 * stop-word lists for frequency statistics.
 */

/** French function words ignored by word-frequency / signature statistics. */
export const FR_STOPWORDS = new Set(
  `a à ai aie ais ait as au aux avec avoir c ça ce ceci cela celle celles celui ces cet cette chez
  ci comme comment d dans de des du donc dont elle elles en encore es est et été être eu eux fait
  faire fais il ils j je jusqu l la le les leur leurs lui m ma mais me même mes moi mon n ne ni non
  nos notre nous on ont ou où par pas plus pour pourquoi qu quand que quel quelle quels qui quoi
  s sa sans se ses si sois soit son sont sous suis sur t ta te tes toi ton tous tout toute toutes
  tu un une vos votre vous y là ici trop très bien fais faut va vais vas veux veut peut peux
  sont était étais avait avais j' l' d' c' qu' n' s' t' m' y'a ya cette cest jsuis chui jai`
    .split(/\s+/)
    .filter(Boolean),
);

export const EN_STOPWORDS = new Set(
  `a an and are as at be been but by can could did do does for from had has have he her him his
  how i if in into is it its just me my no not of on or our out she so that the their them then
  there they this to up us was we were what when where which who will with would you your yeah
  oh im i'm it's don't can't ain't gonna wanna got get`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Very common French content words. A word is only a "signature" word of the
 * artist if it is NOT in this list (cheap substitute for a TF-IDF baseline).
 */
export const FR_COMMON = new Set(
  `vie temps jour jours nuit monde gens homme femme fille gars mec frère frères soeur mère père
  coeur cœur tête main mains yeux corps âme rien chose choses fois toujours jamais rien personne
  dire dit dis vois voir sais savoir veux vouloir peux pouvoir faut aller viens venir prendre
  prends donner donne mettre mets parler parle aime aimer sens sentir pense penser crois croire
  reste rester laisse laisser passe passer trouve trouver regarde regarder attendre attends
  vrai vraiment grand grande petit petite bon bonne mal mauvais nouveau vieux beau belle
  autre autres même seul seule tout toute tous rien plus moins assez beaucoup peu encore
  maintenant demain hier aujourd'hui avant après depuis pendant toujours souvent parfois
  ouais oui non hein bah ben wesh yo eh oh ah`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * English words that frequently appear in French lyrics. Used to route the
 * word to the English syllable counter. (Words also valid in French, like
 * "fan" or "cool", are counted identically by both counters anyway.)
 */
export const EN_WORDS = new Set(
  `yeah yeh yah baby babe money cash gang game life love time night light right fight like
  nice price ice dice smoke shot shit fuck fucking bitch bitches nigga niggas real feel deal
  wheel street streets flow show slow know no go so ok okay hey yo bro bros boss trap drip
  every everything everyday nothing something anything everybody nobody somebody really
  forever never ever better crazy lady party body story only lonely money honey sorry
  hustle hustler gun guns run sun fun one gone done come home alone phone zone lone rolling
  bling king ring thing things bring sing wing swing living giving feeling killing chilling
  my mind mine fine line shine wine sign high fly sky cry die eye lie try why bye guy
  the you me we he she they them this that what when where who why with without want need
  call ball fall all small wall tall girl world word words heart start part smart dark park
  drill gangster gangsta rapper rap trap flex vibe vibes swag style hype crew squad hood
  baller dealer killer winner loser hater haters lover`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Hand-checked syllable counts (spoken / rap counting) for words the rules get
 * wrong. Keys are lower-case without punctuation.
 */
export const SYLLABLE_OVERRIDES: Record<string, number> = {
  // French
  oui: 1, ouais: 1, hein: 1, wesh: 1, frérot: 2, frero: 2, khey: 1, starfoullah: 3,
  wallah: 2, wallay: 2, hamdoullah: 3, inchallah: 3, mashallah: 3, zarma: 2, bendo: 2,
  pays: 2, paysan: 2, abbaye: 2, ail: 1, oeil: 1, œil: 1, fille: 1, ville: 1, mille: 1,
  tranquille: 2, monsieur: 2, femme: 1, second: 2, seconde: 2, eh: 1, oh: 1, ah: 1,
  aujourd: 2, "aujourd'hui": 3, christ: 1, jésus: 2, sept: 1, huit: 1, dix: 1, six: 1,
  // English (spoken)
  yeah: 1, yeh: 1, baby: 2, every: 2, everything: 3, everyday: 3, everybody: 4, really: 2,
  people: 2, little: 2, fire: 1, hour: 1, our: 1, real: 1, rolling: 2, being: 2,
  business: 2, different: 2, family: 3, beautiful: 3, maybe: 2, lady: 2, crazy: 2,
  ok: 2, okay: 2, gangsta: 2, gangster: 2, forever: 3, whatever: 3, whenever: 3,
  hustle: 2, hustler: 2, smile: 1, while: 1, style: 1, five: 1, life: 1, time: 1,
  mind: 1, nigga: 2, niggas: 2, shawty: 2, homie: 2, homies: 2, swagger: 2,
};

/**
 * Words ending in "-ent" where the ending IS pronounced (nouns, adjectives,
 * adverbs). Verbs in the 3rd person plural ("ils parlent") have a silent
 * "-ent"; we treat "-ent" as silent unless the word is listed here or ends in
 * "-ment" (adverbs/nouns) and is not in VERBS_ENDING_IN_MENT.
 */
export const PRONOUNCED_ENT = new Set(
  `dent dents vent vents lent lente cent cents gent souvent argent content contents présent
  absent accident accidents évident talent talents parent parents client clients urgent agent
  agents serpent torrent moment moments comment vraiment seulement autrement violent violents
  silent patient prudent récent récents différent différents équivalent excellent innocent
  intelligent insolent indulgent permanent pourcent pendant ardent strident fréquent couvent
  continent adolescent président incident sergent orient occident aliment ciment segment
  argument instrument document élément événement évènement sentiment gouvernement
  appartement mouvement monument paiement jugement tellement lentement doucement rapidement
  froidement durement simplement surement sûrement vachement grandement`
    .split(/\s+/)
    .filter(Boolean),
);

/** Verbs whose 3rd-person plural ends in "-ment" (silent "-ent"). */
export const VERBS_ENDING_IN_MENT = new Set(
  `aiment sèment ferment dorment ment mentent fument riment calment allument consument
  priment expriment impriment suppriment déciment estiment affirment confirment informent
  forment transforment arment désarment alarment charment nomment assomment gomment
  somment`
    .split(/\s+/)
    .filter(Boolean),
);

/** Words ending in "-er" where the final r IS pronounced ([ɛʁ]). */
export const PRONOUNCED_ER = new Set(
  `mer fer cher chers fier fière hier hiver enfer amer ver vers super cancer laser poster
  hamburger leader dealer rapper player hater lover killer winner loser baller gangster
  bitter tiers revolver sweater cuiller cuiller mister`
    .split(/\s+/)
    .filter(Boolean),
);

/** Monosyllables whose only vowel is a pronounced schwa. */
export const SCHWA_MONOSYLLABLES = new Set([
  "le", "je", "me", "te", "se", "ce", "de", "ne", "que", "re",
]);

/** Determiners/pronouns in "-es" pronounced [e]. */
export const ES_AS_E = new Set(["les", "des", "mes", "tes", "ses", "ces", "es"]);
