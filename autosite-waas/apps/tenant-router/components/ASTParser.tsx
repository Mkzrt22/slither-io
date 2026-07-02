import React from "react";
import type { WebsiteAST } from "@autosite/ai-core";

interface ParserProps {
  ast: WebsiteAST;
  websiteId: string;
}

export const ASTParser: React.FC<ParserProps> = ({ ast, websiteId }) => {
  return (
    <div style={{ fontFamily: ast.theme.fontFamily }} className="w-full min-h-screen flex flex-col">
      {ast.nodes.map((node) => {
        switch (node.type) {
          case "navbar":
            return (
              <nav key={node.id} className="w-full p-4 flex justify-between items-center bg-white border-b border-zinc-100">
                <span className="font-bold text-xl">{node.content.logoText}</span>
                <div className="flex gap-4">
                  {node.content.links?.map((link: string, idx: number) => (
                    <a key={idx} href="#" className="text-zinc-600 hover:text-black transition-colors">
                      {link}
                    </a>
                  ))}
                </div>
              </nav>
            );
          case "hero":
            return (
              <header key={node.id} className="w-full px-8 py-24 text-center flex flex-col items-center justify-center bg-zinc-50">
                <h1 className="text-5xl font-extrabold tracking-tight max-w-3xl mb-6 text-zinc-900">
                  {node.content.headline}
                </h1>
                <p className="text-lg text-zinc-600 max-w-xl mb-8">{node.content.subheadline}</p>
                <button
                  style={{ backgroundColor: ast.theme.primaryColor }}
                  className="px-6 py-3 text-white font-medium rounded-lg shadow-sm hover:opacity-90 transition-opacity"
                >
                  {node.content.ctaText}
                </button>
              </header>
            );
          case "features":
            return (
              <section key={node.id} className="w-full px-8 py-20 bg-white grid grid-cols-1 md:grid-cols-3 gap-8 max-w-7xl mx-auto">
                {node.content.items?.map((item: { title: string; description: string }, idx: number) => (
                  <div key={idx} className="p-6 border border-zinc-100 rounded-xl bg-zinc-50/50">
                    <h3 className="font-bold text-xl mb-2 text-zinc-900">{item.title}</h3>
                    <p className="text-zinc-600">{item.description}</p>
                  </div>
                ))}
              </section>
            );
          case "form":
            return (
              <section key={node.id} className="w-full px-8 py-16 bg-zinc-50 border-t border-b border-zinc-100">
                <div className="max-w-md mx-auto bg-white p-8 rounded-2xl border border-zinc-200/60 shadow-sm">
                  <h2 className="text-2xl font-bold mb-2 text-center text-zinc-900">{node.content.formTitle}</h2>
                  <p className="text-sm text-zinc-500 text-center mb-6">{node.content.formSubtitle}</p>
                  <form className="flex flex-col gap-4" action={`/api/leads/${websiteId}`} method="POST">
                    <input
                      type="email"
                      name="email"
                      required
                      placeholder="Enter your email"
                      className="w-full px-4 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2"
                    />
                    <button
                      type="submit"
                      style={{ backgroundColor: ast.theme.primaryColor }}
                      className="w-full py-2.5 text-white font-medium rounded-lg hover:opacity-90 transition-opacity"
                    >
                      {node.content.submitText || "Submit"}
                    </button>
                  </form>
                </div>
              </section>
            );
          case "footer":
            return (
              <footer key={node.id} className="w-full p-8 mt-auto bg-zinc-900 text-zinc-400 text-center text-sm border-t border-zinc-800">
                <p>{node.content.footerText} — Powered by AutoSite</p>
              </footer>
            );
          default:
            return null;
        }
      })}
    </div>
  );
};
