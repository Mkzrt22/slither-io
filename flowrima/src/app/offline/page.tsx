export const metadata = { title: "Hors ligne" };

export default function OfflinePage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">Pas de réseau</h1>
      <p className="text-muted">
        Flowrima a besoin d&apos;une connexion pour écrire avec l&apos;IA. Tes textes sont enregistrés : reviens dès que le réseau est de retour.
      </p>
    </main>
  );
}
