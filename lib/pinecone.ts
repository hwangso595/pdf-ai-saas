import { Pinecone, PineconeRecord } from "@pinecone-database/pinecone";
import { downloadFromS3 } from "./s3-server";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import {
  Document,
  RecursiveCharacterTextSplitter,
} from "@pinecone-database/doc-splitter";
import md5 from "md5";
import { getEmbeddings } from "./embeddings";
import { convertToAscii } from "./utils";
let pinecone: Pinecone | null = null;

export const getPinecone = async () => {
  if (!pinecone) {
    pinecone = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY!,
    });
  }
  return pinecone;
};

type PDFPage = {
  pageContent: string;
  metadata: {
    loc: { pageNumber: number };
  };
};

export async function loadS3IntoPinecone(fileKey: string) {
  // download and read from pdf
  console.log("Loading into pinecone");
  const file_name = await downloadFromS3(fileKey);
  if (!file_name) {
    throw new Error("File not found");
  }
  const loader = new PDFLoader(file_name);
  const pages = (await loader.load()) as PDFPage[];

  // split and segment the pdf
  const docs = await Promise.all(pages.map(prepareDocument));

  // vectorize and embed individual docs
  const embeddings = await Promise.all(docs.flat().map(embedDocument));

  // upload to pinecone
  const client = await getPinecone();
  const pineconeIndex = client.Index("chatpdf");

  console.log("inserting vectors into pinecone");
  const namespace = convertToAscii(fileKey);
  await pineconeIndex.namespace(namespace).upsert(embeddings);
  return docs[0];
}

async function embedDocument(doc: Document) {
  try {
    const embeddings = await getEmbeddings(doc.pageContent);
    const hash = md5(doc.pageContent);
    return {
      id: hash,
      values: embeddings,
      metadata: {
        pageNumber: doc.metadata.pageNumber,
        text: doc.metadata.text,
      },
    } as PineconeRecord;
  } catch (error) {
    console.error("Error embedding document", error);
    throw error;
  }
}

export const truncateStringByBytes = (str: string, bytes: number) => {
  const enc = new TextEncoder();
  return new TextDecoder("utf-8").decode(enc.encode(str).slice(0, bytes));
};

async function prepareDocument(page: PDFPage) {
  let { pageContent, metadata } = page;
  pageContent = pageContent.replace(/(\r\n|\n|\r)/gm, " ");
  const splitter = new RecursiveCharacterTextSplitter();
  const doc = await splitter.splitDocuments([
    new Document({
      pageContent,
      metadata: {
        pageNumber: metadata.loc.pageNumber,
        text: truncateStringByBytes(pageContent, 38000),
      },
    }),
  ]);
  return doc;
}
