import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface WebsiteASTNode {
  type: "navbar" | "hero" | "features" | "form" | "footer";
  id: string;
  styles: Record<string, string>;
  content: Record<string, any>;
}

export interface WebsiteAST {
  title: string;
  theme: {
    primaryColor: string;
    fontFamily: string;
  };
  nodes: WebsiteASTNode[];
}

export const websiteASTJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    theme: {
      type: "object",
      properties: {
        primaryColor: { type: "string" },
        fontFamily: { type: "string" },
      },
      required: ["primaryColor", "fontFamily"],
    },
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["navbar", "hero", "features", "form", "footer"] },
          id: { type: "string" },
          styles: { type: "object" },
          content: { type: "object" },
        },
        required: ["type", "id", "styles", "content"],
      },
    },
  },
  required: ["title", "theme", "nodes"],
} as const;

export async function generateWebsiteAST(businessContext: string): Promise<WebsiteAST> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4000,
    tools: [
      {
        name: "emit_website_ast",
        description: "Emit the generated website structure as a validated AST.",
        input_schema: websiteASTJsonSchema,
      },
    ],
    tool_choice: { type: "tool", name: "emit_website_ast" },
    messages: [
      {
        role: "user",
        content: `Generate a website configuration for this business: ${businessContext}`,
      },
    ],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );

  if (!toolUse) {
    throw new Error("AI pipeline failure: model did not return a tool_use block with the website AST.");
  }

  return toolUse.input as WebsiteAST;
}
