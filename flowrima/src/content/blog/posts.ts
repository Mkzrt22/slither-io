/**
 * SEO blog posts (French). Blocks keep the content structured without an MDX
 * pipeline; add a post by appending to POSTS.
 */
export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "quote"; text: string };

export interface Post {
  slug: string;
  title: string;
  description: string;
  date: string;
  readingMinutes: number;
  blocks: Block[];
}

export const POSTS: Post[] = [
  {
    slug: "panne-inspiration-rap",
    title: "Panne d'inspiration en rap : 7 méthodes pour débloquer un couplet",
    description:
      "Page blanche avant une session studio ? Sept techniques concrètes utilisées par les rappeurs pour relancer l'écriture, du mot-clé imposé à la contrainte de rimes.",
    date: "2026-10-01",
    readingMinutes: 6,
    blocks: [
      { type: "p", text: "La page blanche touche tout le monde, surtout quand on sort des titres régulièrement. Bonne nouvelle : l'inspiration se provoque. Voici sept méthodes simples à tester dès ta prochaine session." },
      { type: "h2", text: "1. Pars d'une image, pas d'un thème" },
      { type: "p", text: "« La solitude » est un thème. « Le dernier métro, assis face à mon reflet » est une image. Une image concrète génère des détails, des sons, des odeurs : de la matière pour huit mesures." },
      { type: "h2", text: "2. Impose-toi une contrainte de rimes" },
      { type: "p", text: "Choisis une sonorité (par exemple en « -ion ») et écris quatre mesures qui finissent dessus, puis change. La contrainte force des associations inattendues et fait naître des punchlines." },
      { type: "h2", text: "3. Réécris un vieux couplet sous un autre angle" },
      { type: "p", text: "Prends un de tes anciens couplets et raconte la même histoire du point de vue d'un autre personnage. Tu restes dans ton univers, mais tu explores un angle neuf. Attention à ne pas recycler tes propres phrases : change les images, pas seulement l'ordre des mots." },
      { type: "h2", text: "4. Écris le refrain en premier" },
      { type: "p", text: "Le refrain résume l'intention du morceau. Une fois qu'il tient en deux ou quatre lignes faciles à chanter, les couplets deviennent des développements de cette idée." },
      { type: "h2", text: "5. Compte tes syllabes" },
      { type: "p", text: "Le flow se joue sur la grille. Sur un beat à 90 BPM, la plupart des rappeurs posent entre 10 et 14 syllabes par mesure. Connaître ta densité habituelle t'aide à écrire des lignes qui tombent juste dès le premier jet." },
      { type: "h2", text: "6. Change de support" },
      { type: "ul", items: ["Écris au téléphone dans le métro, pas seulement au studio.", "Dicte une idée en vocal et transcris-la ensuite.", "Garde une note « idées de punchlines » toujours ouverte."] },
      { type: "h2", text: "7. Utilise un co-auteur" },
      { type: "p", text: "Un ami, un toplineur… ou une IA entraînée sur ton style. Flowrima analyse ton ADN artistique (thèmes, rimes, flow) et propose trois pistes complètes : une fidèle, une évolution, une prise de risque. Tu gardes ce qui te ressemble et tu réécris le reste : c'est ton apport créatif qui fait l'œuvre." },
      { type: "quote", text: "L'inspiration n'est pas un don, c'est une méthode : provoque-la, puis garde ce qui sonne vraiment comme toi." },
    ],
  },
  {
    slug: "rimes-multisyllabiques",
    title: "Rimes multisyllabiques : le guide pour enrichir tes couplets",
    description:
      "Rime pauvre, suffisante, riche, multisyllabique, interne : comprendre les niveaux de rime en français et les utiliser pour densifier ton flow.",
    date: "2026-10-05",
    readingMinutes: 7,
    blocks: [
      { type: "p", text: "Les rimes multisyllabiques (ou « multis ») font rimer plusieurs syllabes à la suite. C'est l'une des marques de fabrique des rappeurs techniques. Encore faut-il comprendre ce qui rime vraiment à l'oreille." },
      { type: "h2", text: "Ce qui rime, c'est le son, pas l'orthographe" },
      { type: "p", text: "« Nuit » et « bruit » riment, « femme » et « flamme » aussi, alors que « fille » et « ville » ne riment qu'à moitié. Pour juger une rime, prononce-la : c'est la dernière voyelle accentuée et les sons qui la suivent qui comptent." },
      { type: "h2", text: "Les niveaux de rime" },
      { type: "ul", items: [
        "Assonance : même voyelle, consonnes différentes (« tête » / « année »).",
        "Rime suffisante : voyelle + consonne qui suit (« ville » / « fil »).",
        "Rime riche : on ajoute la consonne d'avant (« années » / « damné »).",
        "Rime multisyllabique : deux syllabes ou plus riment (« des millions » / « des visions »).",
      ] },
      { type: "h2", text: "La technique du squelette de voyelles" },
      { type: "p", text: "Écris les voyelles de la fin de ta ligne : « des millions » donne é-i-on. Cherche ensuite d'autres groupes de mots avec le même squelette : « des visions », « les ambitions » (sur les deux dernières). Plus le squelette commun est long, plus la rime est dense." },
      { type: "h2", text: "Les rimes internes" },
      { type: "p", text: "Une rime interne apparaît au milieu de la ligne et répond à la fin d'une autre. Bien placées, elles donnent l'impression d'un flow qui « roule » sans alourdir le texte." },
      { type: "h2", text: "Mesurer sa densité de rimes" },
      { type: "p", text: "La densité de rimes, c'est la part de syllabes qui participent à une rime. Dans Flowrima, l'éditeur colore chaque famille de rimes et ton ADN indique ta densité moyenne : tu vois tout de suite si une proposition est plus riche ou plus simple que ton style habituel." },
    ],
  },
  {
    slug: "compter-syllabes-couplet",
    title: "Compter les syllabes d'un couplet de rap : méthode et BPM",
    description:
      "Combien de syllabes par mesure selon le BPM, comment compter le e muet et les élisions, et pourquoi c'est la clé d'un flow qui tombe juste.",
    date: "2026-10-10",
    readingMinutes: 5,
    blocks: [
      { type: "p", text: "En rap, une mesure (4 temps) accueille généralement une ligne. Le nombre de syllabes que tu y places définit ton débit. Savoir les compter, c'est écrire des lignes qui tiennent sur la prod dès le premier enregistrement." },
      { type: "h2", text: "Compter comme on rappe, pas comme à l'école" },
      { type: "ul", items: [
        "Le e muet final ne se prononce pas : « rappe » = 1 syllabe.",
        "Les élisions comptent : « j'suis » = 1, « p'tit » = 1.",
        "Les groupes de voyelles se contractent souvent : « lion », « violent » se disent en une émission.",
        "Les chiffres se rappent en toutes lettres : « 93 » = « quatre-vingt-treize » = 3 syllabes.",
      ] },
      { type: "h2", text: "Combien de syllabes selon le BPM ?" },
      { type: "p", text: "Plus le tempo est rapide, moins tu as de place par mesure. Repères courants : boom-bap à 85-95 BPM, 10 à 14 syllabes ; trap à 140 BPM (pensée en half-time), 8 à 12 avec des accélérations en triolets ; R&B lent, 6 à 9 syllabes chantées." },
      { type: "h2", text: "Ta densité est une signature" },
      { type: "p", text: "Certains artistes sont reconnaissables à leur débit. Mesurer ta moyenne de syllabes par mesure sur tes titres sortis te donne une cible quand tu écris sur une nouvelle prod. C'est exactement ce que fait l'analyse ADN de Flowrima, puis l'éditeur affiche le compte de chaque ligne en direct et signale celles qui sortent de ta zone." },
    ],
  },
];

export function getPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}
