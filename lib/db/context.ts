import { Pinecone } from "@pinecone-database/pinecone";
import { convertToAscii } from "../utils";
import { getEmbeddings } from "../embeddings";

export async function getMatchesFromEmbeddings(
  embeddings: number[],
  fileKey: string
) {
  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!,
  });
  const pineconeIndex = pinecone.Index("chatpdf");
  try {
    const namespace = convertToAscii(fileKey);

    const queryResult = await pineconeIndex.namespace(namespace).query({
      vector: embeddings,
      includeMetadata: true,
      topK: 5,
    });
    return queryResult.matches || [];
  } catch (error) {
    console.log("error querying embeddings", error);
    throw error;
  }
}

export async function getContext(query: string, fileKey: string) {
  const queryEmbeddings = await getEmbeddings(query);
  const matches = await getMatchesFromEmbeddings(queryEmbeddings, fileKey);
  const qualifyingDocs = matches.filter(
    (match) => match.score && match.score > 0.7
  );

  let docs = qualifyingDocs.map((match) =>
    match.metadata ? match.metadata.text : ""
  );
  return docs.join("\n").substring(0, 3000);
}
