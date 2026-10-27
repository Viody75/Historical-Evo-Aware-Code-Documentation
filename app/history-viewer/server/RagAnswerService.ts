import { PostgresHistoryStore } from "@/app/history-viewer/server/PostgresHistoryStore";
import type {
  RagCitation,
  RagQueryResult,
  RagRetrievedDocument,
} from "@/app/history-viewer/types";

const DEFAULT_RAG_MODEL = "gpt-5-mini";
const MAX_CONTEXT_CHARACTERS = 28_000;

type ResponsesApiPayload = {
  error?: { message?: string };
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

type GeneratedRagAnswer = {
  answer: string;
  citations: RagCitation[];
};

function extractOutputText(payload: ResponsesApiPayload) {
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text" && content.text)
    .map((content) => content.text || "")
    .join("");
}

function buildContext(documents: RagRetrievedDocument[]) {
  let remainingCharacters = MAX_CONTEXT_CHARACTERS;
  const blocks: string[] = [];

  for (const document of documents) {
    if (remainingCharacters <= 0) {
      break;
    }

    const header = [
      `DOCUMENT_ID: ${document.id}`,
      `TYPE: ${document.kind}`,
      `TITLE: ${document.title}`,
      `ISSUE: ${document.issueNumber ?? "-"}`,
      `COMMIT: ${document.commitSha || "-"}`,
      `FILE: ${document.filename || "-"}`,
      `EVIDENCE_REFS: ${document.evidenceRefs.join(", ") || "-"}`,
    ].join("\n");
    const availableContent = Math.max(
      0,
      remainingCharacters - header.length - 20,
    );
    const content = document.content.slice(0, availableContent);
    const block = `${header}\nCONTENT:\n${content}`;

    blocks.push(block);
    remainingCharacters -= block.length;
  }

  return blocks.join("\n\n---\n\n");
}

function createResponseSchema() {
  return {
    type: "json_schema" as const,
    name: "repository_history_rag_answer",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["answer", "citations"],
      properties: {
        answer: { type: "string" },
        citations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["documentId", "claim"],
            properties: {
              documentId: { type: "string" },
              claim: { type: "string" },
            },
          },
        },
      },
    },
  };
}

async function generateAnswer(input: {
  apiKey: string;
  model: string;
  question: string;
  documents: RagRetrievedDocument[];
}) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      reasoning: { effort: "low" },
      text: {
        verbosity: "medium",
        format: createResponseSchema(),
      },
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You answer questions about a repository's implementation history.",
                "Use only the retrieved documents provided by the user message.",
                "Answer in the same language as the question.",
                "Separate facts from cautious inference.",
                "If the retrieved evidence is insufficient, say what is missing instead of inventing an answer.",
                "Every material claim must have a citation entry.",
                "Citation documentId values must exactly match a provided DOCUMENT_ID.",
                "Keep the answer concise but technically specific.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `QUESTION:\n${input.question}`,
                `RETRIEVED_DOCUMENTS:\n${buildContext(input.documents)}`,
              ].join("\n\n"),
            },
          ],
        },
      ],
    }),
  });

  const raw = (await response
    .json()
    .catch(() => null)) as ResponsesApiPayload | null;

  if (!response.ok) {
    throw new Error(raw?.error?.message || "OpenAI RAG answer generation failed");
  }

  const outputText = raw ? extractOutputText(raw) : "";
  if (!outputText) {
    throw new Error("OpenAI did not return a structured RAG answer");
  }

  return JSON.parse(outputText) as GeneratedRagAnswer;
}

export class RagAnswerService {
  constructor(private readonly postgresStore = new PostgresHistoryStore()) {}

  getDefaultModel() {
    return DEFAULT_RAG_MODEL;
  }

  async query(input: {
    repo: string;
    snapshotId?: string;
    question: string;
    limit?: number;
    apiKey?: string;
    model?: string;
    retrieveOnly?: boolean;
  }): Promise<RagQueryResult> {
    const searchResult = await this.postgresStore.searchRagDocuments({
      repo: input.repo,
      snapshotId: input.snapshotId,
      question: input.question,
      limit: input.limit,
    });

    if (!searchResult) {
      throw new Error(
        "RAG index was not found for this repository or snapshot. Index the snapshot first.",
      );
    }

    const generatedAt = new Date().toISOString();
    if (input.retrieveOnly || searchResult.documents.length === 0) {
      return {
        repo: input.repo,
        snapshotId: searchResult.snapshotId,
        question: input.question,
        answer:
          searchResult.documents.length === 0
            ? "No indexed evidence matched this question."
            : null,
        citations: [],
        retrievedDocuments: searchResult.documents,
        retrievalMethod: searchResult.retrievalMethod,
        model: null,
        generatedAt,
      };
    }

    if (!input.apiKey) {
      throw new Error("OpenAI API key is required to generate a RAG answer");
    }

    const model = input.model?.trim() || DEFAULT_RAG_MODEL;
    const generated = await generateAnswer({
      apiKey: input.apiKey,
      model,
      question: input.question,
      documents: searchResult.documents,
    });
    const validDocumentIds = new Set(
      searchResult.documents.map((document) => document.id),
    );

    return {
      repo: input.repo,
      snapshotId: searchResult.snapshotId,
      question: input.question,
      answer: generated.answer,
      citations: generated.citations.filter((citation) =>
        validDocumentIds.has(citation.documentId),
      ),
      retrievedDocuments: searchResult.documents,
      retrievalMethod: searchResult.retrievalMethod,
      model,
      generatedAt,
    };
  }
}
