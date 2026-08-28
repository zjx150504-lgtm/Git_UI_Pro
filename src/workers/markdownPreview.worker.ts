import { marked } from "marked";

interface MarkdownWorkerRequest {
  id: number;
  content: string;
}

interface MarkdownWorkerResponse {
  id: number;
  html?: string;
  error?: string;
}

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<MarkdownWorkerRequest>) => void) | null;
  postMessage: (message: MarkdownWorkerResponse) => void;
};

workerScope.onmessage = (event) => {
  const { id, content } = event.data;
  void Promise.resolve(marked.parse(content, {
    gfm: true,
    breaks: false
  })).then((html) => {
    workerScope.postMessage({ id, html });
  }).catch((reason) => {
    workerScope.postMessage({
      id,
      error: reason instanceof Error ? reason.message : String(reason)
    });
  });
};

export {};
