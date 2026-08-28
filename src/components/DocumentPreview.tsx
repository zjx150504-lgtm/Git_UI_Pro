import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";
import { AlertTriangle, Presentation, Sheet } from "lucide-react";
import type { UponSanitizeAttributeHook } from "dompurify";
import type { ChangedFile, DiffLine, FilePreview } from "../types/domain";

interface DocumentPreviewProps {
  preview: FilePreview;
  filePath: string;
}

interface TextDocumentPreviewProps {
  filePath: string;
  status: ChangedFile["status"];
  diffLines: DiffLine[];
}

interface RichPreviewState {
  html: string;
  warnings: string[];
}

interface MarkdownPreviewBatch {
  start: number;
  end: number;
  html: string;
}

interface MarkdownPreviewCacheEntry {
  content: string;
  batches: MarkdownPreviewBatch[];
  nextOffset: number;
  pending?: Promise<MarkdownPreviewBatch>;
}

interface MarkdownWorkerResponse {
  id: number;
  html?: string;
  error?: string;
}

interface SpreadsheetTable {
  name: string;
  rows: string[][];
  startColumn: number;
  totalRows: number;
  totalColumns: number;
}

interface PresentationSlide {
  number: number;
  paragraphs: string[];
}

interface SpreadsheetWorkbook {
  api: typeof import("xlsx");
  workbook: import("xlsx").WorkBook;
}

const SPREADSHEET_MAX_ROWS = 200;
const SPREADSHEET_MAX_COLUMNS = 50;
const MARKDOWN_CACHE_LIMIT = 8;
const MARKDOWN_BATCH_TARGET_CHARACTERS = 24_000;
const MARKDOWN_BATCH_TARGET_LINES = 400;
const MARKDOWN_BATCH_MIN_CHARACTERS = 8_000;
const MARKDOWN_BATCH_ABSOLUTE_MAX_CHARACTERS = 80_000;
const pdfBlobCache = new WeakMap<FilePreview, Promise<Blob>>();
const wordPreviewCache = new WeakMap<FilePreview, Promise<RichPreviewState>>();
const spreadsheetWorkbookCache = new WeakMap<FilePreview, Promise<SpreadsheetWorkbook>>();
const presentationPreviewCache = new WeakMap<FilePreview, Promise<PresentationSlide[]>>();
const markdownPreviewCache = new Map<string, MarkdownPreviewCacheEntry>();
const markdownWorkerRequests = new Map<number, {
  resolve: (html: string) => void;
  reject: (error: Error) => void;
}>();
let markdownWorker: Worker | undefined;
let markdownWorkerRequestId = 0;

export function BinaryDocumentPreview({ preview, filePath }: DocumentPreviewProps) {
  if (preview.type === "pdf") {
    return <PdfPreview preview={preview} filePath={filePath} />;
  }
  if (preview.type === "document") {
    return <WordDocumentPreview preview={preview} filePath={filePath} />;
  }
  if (preview.type === "spreadsheet") {
    return <SpreadsheetPreview preview={preview} filePath={filePath} />;
  }
  if (preview.type === "presentation") {
    return <PresentationPreview preview={preview} filePath={filePath} />;
  }
  return null;
}

export function TextDocumentPreview({ filePath, status, diffLines }: TextDocumentPreviewProps) {
  const content = reconstructDisplayedText(diffLines, status);
  if (isMarkdownFilePath(filePath)) {
    return <MarkdownPreview content={content} filePath={filePath} />;
  }
  return <SpreadsheetPreview textContent={content} filePath={filePath} />;
}

export function textReaderKind(filePath: string): "markdown" | "spreadsheet" | undefined {
  if (isMarkdownFilePath(filePath)) {
    return "markdown";
  }
  if (/\.(?:csv|tsv)$/i.test(filePath)) {
    return "spreadsheet";
  }
  return undefined;
}

export function isMarkdownFilePath(filePath: string): boolean {
  return /\.(?:md|mdown|markdown|mdx|mkd|mkdn)$/i.test(filePath);
}

function PdfPreview({ preview, filePath }: DocumentPreviewProps) {
  const [objectUrl, setObjectUrl] = useState("");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let currentUrl = "";
    setObjectUrl("");
    setLoadError("");
    void cachedPreviewResult(pdfBlobCache, preview, () => dataUrlToBlob(preview.dataUrl, preview.mimeType))
      .then((blob) => {
        if (cancelled) {
          return;
        }
        currentUrl = URL.createObjectURL(blob);
        setObjectUrl(currentUrl);
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(errorMessage(error, "无法准备 PDF 预览。"));
        }
      });

    return () => {
      cancelled = true;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [preview.dataUrl, preview.mimeType]);

  if (loadError) {
    return <DocumentPreviewError message={loadError} />;
  }

  return (
    <div className="document-preview pdf-preview">
      {objectUrl ? (
        <iframe
          className="pdf-preview-frame"
          src={`${objectUrl}#view=FitH&toolbar=1&navpanes=1`}
          title={`${fileName(filePath)} PDF 阅读器`}
          onError={() => setLoadError("当前 Chromium 环境无法加载这个 PDF。")}
        />
      ) : <DocumentPreviewLoading label="正在准备 PDF 阅读器" />}
      <DocumentPreviewMeta preview={preview} note="内置 PDF 阅读器支持翻页、缩放、搜索和打印" />
    </div>
  );
}

function MarkdownPreview({ content, filePath }: { content: string; filePath: string }) {
  const [batches, setBatches] = useState<MarkdownPreviewBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const cacheEntryRef = useRef<MarkdownPreviewCacheEntry>();
  const scrollRootRef = useRef<HTMLElement>(null);
  const loadSentinelRef = useRef<HTMLDivElement>(null);
  const viewGenerationRef = useRef(0);

  const loadNextBatch = useCallback(async () => {
    const entry = cacheEntryRef.current;
    if (!entry || entry.nextOffset >= entry.content.length) {
      return;
    }

    const generation = viewGenerationRef.current;
    setLoading(true);
    setError("");
    try {
      await loadNextMarkdownBatch(entry);
      if (viewGenerationRef.current === generation && cacheEntryRef.current === entry) {
        setBatches([...entry.batches]);
      }
    } catch (reason) {
      if (viewGenerationRef.current === generation && cacheEntryRef.current === entry) {
        setError(errorMessage(reason, "无法继续排版 Markdown。"));
      }
    } finally {
      if (viewGenerationRef.current === generation && cacheEntryRef.current === entry) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const generation = viewGenerationRef.current + 1;
    viewGenerationRef.current = generation;
    const entry = cachedMarkdownPreviewEntry(filePath, content);
    cacheEntryRef.current = entry;
    setBatches([...entry.batches]);
    setLoading(Boolean(entry.pending));
    setError("");

    if (entry.batches.length === 0 || entry.pending) {
      void loadNextBatch();
    }

    return () => {
      if (viewGenerationRef.current === generation) {
        viewGenerationRef.current += 1;
      }
    };
  }, [content, filePath, loadNextBatch]);

  const loadedCharacters = batches.at(-1)?.end ?? 0;
  const hasMore = loadedCharacters < content.length;

  useEffect(() => {
    const scrollRoot = scrollRootRef.current;
    const sentinel = loadSentinelRef.current;
    if (!scrollRoot || !sentinel || !hasMore || loading || error || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadNextBatch();
      }
    }, {
      root: scrollRoot,
      rootMargin: "0px 0px 320px 0px",
      threshold: 0
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [batches.length, error, hasMore, loading, loadNextBatch]);

  if (batches.length === 0 && loading) {
    return <DocumentPreviewLoading label="正在排版 Markdown" />;
  }

  return (
    <div className="document-preview text-document-preview">
      <article
        ref={scrollRootRef}
        className="rich-document markdown-document"
        aria-label={`${fileName(filePath)} Markdown 阅读视图`}
        aria-busy={loading}
        data-loaded-characters={loadedCharacters}
        data-total-characters={content.length}
        onClick={handleRichContentClick}
        onScroll={(event) => {
          const target = event.currentTarget;
          if (hasMore && !loading && !error && target.scrollHeight - target.scrollTop - target.clientHeight < 320) {
            void loadNextBatch();
          }
        }}
      >
        {batches.map((batch, index) => (
          <section
            className="markdown-document-batch"
            data-markdown-batch-index={index}
            dangerouslySetInnerHTML={{ __html: batch.html }}
            key={`${batch.start}-${batch.end}`}
          />
        ))}
        {hasMore || loading || error ? (
          <div ref={loadSentinelRef} className={`markdown-load-more ${error ? "error" : ""}`} role="status" aria-live="polite">
            {error ? (
              <>
                <span>{error}</span>
                <button type="button" onClick={() => void loadNextBatch()}>重试加载下一批</button>
              </>
            ) : loading ? (
              <>
                <span className="editor-diff-loading-spinner" aria-hidden="true" />
                <span>正在排版下一批内容…</span>
              </>
            ) : (
              <>
                <span>继续向下滚动即可加载后续内容</span>
                <button type="button" onClick={() => void loadNextBatch()}>加载下一批</button>
              </>
            )}
          </div>
        ) : null}
      </article>
      <div className="document-preview-footnote" aria-live="polite">
        {hasMore
          ? `Markdown 阅读模式 · 已排版 ${loadedCharacters.toLocaleString("zh-CN")} / ${content.length.toLocaleString("zh-CN")} 个字符 · 向下滚动继续加载`
          : "Markdown 阅读模式 · 已加载完整文档 · 远程图片和嵌入内容已禁用"}
      </div>
    </div>
  );
}

function WordDocumentPreview({ preview, filePath }: DocumentPreviewProps) {
  const [state, setState] = useState<RichPreviewState>();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState(undefined);
    setError("");

    void cachedPreviewResult(wordPreviewCache, preview, async () => {
      const extension = fileExtension(filePath);
      const [arrayBuffer, purifierModule] = await Promise.all([
        dataUrlToArrayBuffer(preview.dataUrl),
        import("dompurify")
      ]);

      if (extension === "odt") {
        const html = await convertOpenDocumentText(arrayBuffer);
        return {
          html: sanitizeRichHtml(purifierModule.default, html, true),
          warnings: []
        };
      }

      const mammothModule = await import("mammoth");
      const result = await mammothModule.default.convertToHtml(
        { arrayBuffer },
        {
          includeEmbeddedStyleMap: false,
          externalFileAccess: false,
          styleMap: [
            "p[style-name='Title'] => h1:fresh",
            "p[style-name='Subtitle'] => p.document-subtitle:fresh"
          ]
        }
      );
      return {
        html: sanitizeRichHtml(purifierModule.default, result.value, true),
        warnings: result.messages.map((message) => message.message).slice(0, 5)
      };
    })
      .then((result) => {
        if (!cancelled) {
          setState(result);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(errorMessage(reason, "无法解析 Word 文档。"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, preview.dataUrl]);

  if (error) {
    return <DocumentPreviewError message={error} />;
  }
  if (!state) {
    return <DocumentPreviewLoading label="正在解析 Word 文档" />;
  }

  return (
    <div className="document-preview word-preview">
      {state.warnings.length > 0 ? (
        <div className="document-preview-notice" role="status">
          <AlertTriangle size={14} />
          文档包含 {state.warnings.length} 项无法完全还原的版式，正文内容仍可阅读。
        </div>
      ) : null}
      <article
        className="rich-document word-document"
        aria-label={`${fileName(filePath)} Word 阅读视图`}
        onClick={handleRichContentClick}
        dangerouslySetInnerHTML={{ __html: state.html }}
      />
      <DocumentPreviewMeta preview={preview} note="只读语义预览，不执行宏和外部资源" />
    </div>
  );
}

function SpreadsheetPreview({
  preview,
  textContent,
  filePath
}: {
  preview?: FilePreview;
  textContent?: string;
  filePath: string;
}) {
  const workbookRef = useRef<SpreadsheetWorkbook>();
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState("");
  const [table, setTable] = useState<SpreadsheetTable>();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    workbookRef.current = undefined;
    setSheetNames([]);
    setActiveSheet("");
    setTable(undefined);
    setError("");

    void (async () => {
      const loaded = preview
        ? await cachedPreviewResult(spreadsheetWorkbookCache, preview, async () => {
            const api = await import("xlsx");
            return {
              api,
              workbook: api.read(await dataUrlToArrayBuffer(preview.dataUrl), { cellDates: true })
            };
          })
        : await (async () => {
            const api = await import("xlsx");
            return {
              api,
              workbook: api.read(textContent ?? "", {
                type: "string",
                cellDates: true,
                ...(fileExtension(filePath) === "tsv" ? { FS: "\t" } : {})
              })
            };
          })();
      if (cancelled) {
        return;
      }
      const { api, workbook } = loaded;
      workbookRef.current = { api, workbook };
      const firstSheet = workbook.SheetNames[0] ?? "";
      setSheetNames(workbook.SheetNames);
      setActiveSheet(firstSheet);
      setTable(readSpreadsheetTable(api, workbook, firstSheet));
    })().catch((reason) => {
      if (!cancelled) {
        setError(errorMessage(reason, "无法解析表格文件。"));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, preview?.dataUrl, textContent]);

  function selectSheet(name: string) {
    const current = workbookRef.current;
    if (!current) {
      return;
    }
    setActiveSheet(name);
    setTable(readSpreadsheetTable(current.api, current.workbook, name));
  }

  if (error) {
    return <DocumentPreviewError message={error} />;
  }
  if (!table) {
    return <DocumentPreviewLoading label="正在解析表格" />;
  }

  const truncated = table.totalRows > SPREADSHEET_MAX_ROWS || table.totalColumns > SPREADSHEET_MAX_COLUMNS;
  return (
    <div className="document-preview spreadsheet-preview">
      <div className="spreadsheet-toolbar">
        <div className="spreadsheet-sheet-tabs" role="tablist" aria-label="工作表">
          {sheetNames.map((name) => (
            <button
              type="button"
              role="tab"
              aria-selected={name === activeSheet}
              className={name === activeSheet ? "active" : ""}
              onClick={() => selectSheet(name)}
              key={name}
            >
              <Sheet size={13} />
              {name}
            </button>
          ))}
        </div>
        <span>{table.totalRows.toLocaleString("zh-CN")} 行 × {table.totalColumns.toLocaleString("zh-CN")} 列</span>
      </div>
      <div className="spreadsheet-table-scroll" role="region" aria-label={`${fileName(filePath)} 表格预览`} tabIndex={0}>
        <table className="spreadsheet-table">
          <thead>
            <tr>
              <th className="spreadsheet-corner" aria-label="行号" />
              {Array.from({ length: Math.min(table.totalColumns, SPREADSHEET_MAX_COLUMNS) }, (_, index) => (
                <th scope="col" key={index}>{spreadsheetColumnLabel(table.startColumn + index)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th scope="row">{rowIndex + 1}</th>
                {Array.from({ length: Math.min(table.totalColumns, SPREADSHEET_MAX_COLUMNS) }, (_, columnIndex) => (
                  <td key={columnIndex}>{row[columnIndex] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {truncated ? (
        <div className="document-preview-footnote">
          为保证流畅度，当前显示前 {SPREADSHEET_MAX_ROWS} 行、{SPREADSHEET_MAX_COLUMNS} 列；完整内容可使用系统应用打开。
        </div>
      ) : null}
      {preview ? <DocumentPreviewMeta preview={preview} note="只读表格预览，公式显示为文件中已保存的结果" /> : null}
    </div>
  );
}

function PresentationPreview({ preview, filePath }: DocumentPreviewProps) {
  const [slides, setSlides] = useState<PresentationSlide[]>();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSlides(undefined);
    setError("");
    void cachedPreviewResult(presentationPreviewCache, preview, () => extractPresentationSlides(preview, filePath))
      .then((result) => {
        if (!cancelled) {
          setSlides(result);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(errorMessage(reason, "无法读取演示文稿。"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, preview.dataUrl]);

  if (error) {
    return <DocumentPreviewError message={error} />;
  }
  if (!slides) {
    return <DocumentPreviewLoading label="正在提取演示文稿内容" />;
  }

  return (
    <div className="document-preview presentation-preview">
      <div className="document-preview-notice" role="status">
        <Presentation size={14} />
        当前为结构化阅读预览，可检查每页文字；动画、图表和复杂版式请使用系统应用查看。
      </div>
      <div className="presentation-slide-list" aria-label={`${fileName(filePath)} 演示文稿预览`}>
        {slides.length > 0 ? slides.map((slide) => (
          <article className="presentation-slide-card" key={slide.number}>
            <div className="presentation-slide-number">{slide.number}</div>
            <div className="presentation-slide-content">
              {slide.paragraphs.length > 0
                ? slide.paragraphs.map((paragraph, index) => index === 0
                  ? <h2 key={index}>{paragraph}</h2>
                  : <p key={index}>{paragraph}</p>)
                : <span className="presentation-slide-empty">这一页没有可提取的文字</span>}
            </div>
          </article>
        )) : (
          <div className="document-preview-empty">
            <Presentation size={24} />
            没有找到可阅读的幻灯片文字。
          </div>
        )}
      </div>
      <DocumentPreviewMeta preview={preview} note={`已读取 ${slides.length} 页`} />
    </div>
  );
}

function DocumentPreviewLoading({ label }: { label: string }) {
  return (
    <div className="document-preview-loading" role="status" aria-live="polite">
      <span className="editor-diff-loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function DocumentPreviewError({ message }: { message: string }) {
  return (
    <div className="document-preview-error" role="alert">
      <AlertTriangle size={20} />
      <div>
        <strong>无法生成阅读预览</strong>
        <p>{message}</p>
        <span>若工作区中存在该文件，可尝试使用顶部的系统打开按钮查看。</span>
      </div>
    </div>
  );
}

function DocumentPreviewMeta({ preview, note }: { preview: FilePreview; note: string }) {
  return (
    <div className="document-preview-meta">
      <span>{preview.sourceDescription}</span>
      <span>{note}</span>
      <span>{formatBytes(preview.sizeBytes)}</span>
    </div>
  );
}

function reconstructDisplayedText(lines: DiffLine[], status: ChangedFile["status"]): string {
  const usePreviousVersion = status === "deleted";
  return lines
    .filter((line) => line.type === "context" || (usePreviousVersion ? line.type === "delete" : line.type === "add"))
    .map((line) => line.content)
    .join("\n");
}

function sanitizeRichHtml(
  purifier: typeof import("dompurify")["default"],
  html: string,
  allowEmbeddedImages: boolean
): string {
  const attributeHook: UponSanitizeAttributeHook = (node, data) => {
    const tagName = node.tagName.toLowerCase();
    if (data.attrName === "src" && tagName === "img") {
      data.keepAttr = allowEmbeddedImages && /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(data.attrValue);
      return;
    }
    if (data.attrName === "href") {
      data.keepAttr = /^(?:https?:|mailto:|#)/i.test(data.attrValue);
    }
  };

  purifier.addHook("uponSanitizeAttribute", attributeHook);
  try {
    return purifier.sanitize(html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "option", "video", "audio", "canvas"],
      FORBID_ATTR: ["style", "srcset", "formaction", "autofocus"],
      ALLOW_DATA_ATTR: false,
      SAFE_FOR_TEMPLATES: true,
      SANITIZE_NAMED_PROPS: true
    });
  } finally {
    purifier.removeHook("uponSanitizeAttribute", attributeHook);
  }
}

function cachedPreviewResult<T>(
  cache: WeakMap<FilePreview, Promise<T>>,
  preview: FilePreview,
  load: () => Promise<T>
): Promise<T> {
  const cached = cache.get(preview);
  if (cached) {
    return cached;
  }
  const pending = load();
  cache.set(preview, pending);
  void pending.catch(() => {
    if (cache.get(preview) === pending) {
      cache.delete(preview);
    }
  });
  return pending;
}

function cachedMarkdownPreviewEntry(filePath: string, content: string): MarkdownPreviewCacheEntry {
  const cached = markdownPreviewCache.get(filePath);
  if (cached?.content === content) {
    markdownPreviewCache.delete(filePath);
    markdownPreviewCache.set(filePath, cached);
    return cached;
  }

  const entry: MarkdownPreviewCacheEntry = {
    content,
    batches: [],
    nextOffset: 0
  };
  markdownPreviewCache.set(filePath, entry);
  while (markdownPreviewCache.size > MARKDOWN_CACHE_LIMIT) {
    const oldestKey = markdownPreviewCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) {
      break;
    }
    markdownPreviewCache.delete(oldestKey);
  }
  return entry;
}

function loadNextMarkdownBatch(entry: MarkdownPreviewCacheEntry): Promise<MarkdownPreviewBatch> {
  if (entry.pending) {
    return entry.pending;
  }

  const start = entry.nextOffset;
  const end = markdownBatchEnd(entry.content, start);
  const markdown = entry.content.slice(start, end);
  const pending = Promise.all([
    parseMarkdownOffMainThread(markdown),
    import("dompurify")
  ]).then(([parsed, purifierModule]) => {
    const batch = {
      start,
      end,
      html: sanitizeRichHtml(purifierModule.default, parsed, false)
    };
    entry.batches.push(batch);
    entry.nextOffset = end;
    return batch;
  }).finally(() => {
    if (entry.pending === pending) {
      entry.pending = undefined;
    }
  });
  entry.pending = pending;
  return pending;
}

function markdownBatchEnd(content: string, start: number): number {
  if (start >= content.length) {
    return content.length;
  }

  const targetEnd = Math.min(content.length, start + MARKDOWN_BATCH_TARGET_CHARACTERS);
  let cursor = start;
  let lineCount = 0;
  let lastSafeBoundary = start;
  let fence: { marker: "`" | "~"; length: number } | undefined;

  while (cursor < content.length) {
    const nextLineBreak = content.indexOf("\n", cursor);
    const lineEnd = nextLineBreak < 0 ? content.length : nextLineBreak + 1;
    const line = content.slice(cursor, nextLineBreak < 0 ? content.length : nextLineBreak);
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      const markerLength = fenceMatch[1].length;
      if (!fence) {
        fence = { marker, length: markerLength };
      } else if (
        fence.marker === marker
        && markerLength >= fence.length
        && line.slice(fenceMatch[0].length).trim().length === 0
      ) {
        fence = undefined;
      }
    }

    lineCount += 1;
    if (!fence && line.trim().length === 0) {
      lastSafeBoundary = lineEnd;
    }

    if (lineEnd > targetEnd + 4_096) {
      const safeBoundaryIsUseful = !fence && lastSafeBoundary >= start + MARKDOWN_BATCH_MIN_CHARACTERS;
      return safeBoundaryIsUseful ? lastSafeBoundary : targetEnd;
    }

    const targetReached = lineEnd >= targetEnd || lineCount >= MARKDOWN_BATCH_TARGET_LINES;
    if (targetReached && !fence) {
      const safeBoundaryIsUseful = lastSafeBoundary >= start + MARKDOWN_BATCH_MIN_CHARACTERS;
      return safeBoundaryIsUseful ? lastSafeBoundary : lineEnd;
    }

    if (lineEnd >= start + MARKDOWN_BATCH_ABSOLUTE_MAX_CHARACTERS) {
      return lineEnd;
    }

    cursor = lineEnd;
  }

  return content.length;
}

function parseMarkdownOffMainThread(content: string): Promise<string> {
  if (typeof Worker === "undefined") {
    return import("marked").then((module) => module.marked.parse(content, { gfm: true, breaks: false }));
  }

  const worker = getMarkdownWorker();
  const id = ++markdownWorkerRequestId;
  return new Promise<string>((resolve, reject) => {
    markdownWorkerRequests.set(id, { resolve, reject });
    worker.postMessage({ id, content });
  });
}

function getMarkdownWorker(): Worker {
  if (markdownWorker) {
    return markdownWorker;
  }

  const worker = new Worker(new URL("../workers/markdownPreview.worker.ts", import.meta.url), {
    type: "module",
    name: "markdown-preview"
  });
  worker.onmessage = (event: MessageEvent<MarkdownWorkerResponse>) => {
    const request = markdownWorkerRequests.get(event.data.id);
    if (!request) {
      return;
    }
    markdownWorkerRequests.delete(event.data.id);
    if (event.data.error) {
      request.reject(new Error(event.data.error));
      return;
    }
    request.resolve(event.data.html ?? "");
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "Markdown 排版线程异常退出。");
    for (const request of markdownWorkerRequests.values()) {
      request.reject(error);
    }
    markdownWorkerRequests.clear();
    worker.terminate();
    if (markdownWorker === worker) {
      markdownWorker = undefined;
    }
  };
  markdownWorker = worker;
  return worker;
}

function handleRichContentClick(event: ReactMouseEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) {
    return;
  }

  const href = anchor.getAttribute("href") ?? "";
  if (href.startsWith("#")) {
    return;
  }
  if (!/^(?:https?:|mailto:)/i.test(href)) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  if (window.gitUI) {
    void window.gitUI.openExternal(href);
  } else {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

function readSpreadsheetTable(
  api: typeof import("xlsx"),
  workbook: import("xlsx").WorkBook,
  sheetName: string
): SpreadsheetTable {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet["!ref"]) {
    return { name: sheetName, rows: [], startColumn: 0, totalRows: 0, totalColumns: 0 };
  }

  const range = api.utils.decode_range(sheet["!ref"]);
  const totalRows = range.e.r - range.s.r + 1;
  const totalColumns = range.e.c - range.s.c + 1;
  const previewRange = {
    s: range.s,
    e: {
      r: Math.min(range.e.r, range.s.r + SPREADSHEET_MAX_ROWS - 1),
      c: Math.min(range.e.c, range.s.c + SPREADSHEET_MAX_COLUMNS - 1)
    }
  };
  const rows = api.utils.sheet_to_json<Array<string | number | boolean>>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
    range: previewRange
  }).map((row) => row.map((cell) => String(cell)));

  return {
    name: sheetName,
    rows,
    startColumn: range.s.c,
    totalRows,
    totalColumns
  };
}

async function extractPresentationSlides(preview: FilePreview, filePath: string): Promise<PresentationSlide[]> {
  const JSZip = (await import("jszip")).default;
  const archive = await JSZip.loadAsync(await dataUrlToArrayBuffer(preview.dataUrl));
  if (fileExtension(filePath) === "odp") {
    const content = await archive.file("content.xml")?.async("string");
    if (!content) {
      return [];
    }
    return extractOpenDocumentSlides(content);
  }

  const slideEntries = Object.keys(archive.files)
    .map((name) => ({ name, match: name.match(/^ppt\/slides\/slide(\d+)\.xml$/i) }))
    .filter((entry): entry is { name: string; match: RegExpMatchArray } => Boolean(entry.match))
    .sort((left, right) => Number(left.match[1]) - Number(right.match[1]));

  return Promise.all(slideEntries.map(async (entry) => {
    const xml = await archive.file(entry.name)!.async("string");
    const document = new DOMParser().parseFromString(xml, "application/xml");
    const paragraphs = Array.from(document.getElementsByTagNameNS("*", "p"))
      .map((paragraph) => Array.from(paragraph.getElementsByTagNameNS("*", "t"))
        .map((node) => node.textContent ?? "")
        .join("")
        .trim())
      .filter(Boolean);
    return { number: Number(entry.match[1]), paragraphs };
  }));
}

function extractOpenDocumentSlides(xml: string): PresentationSlide[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(document.getElementsByTagNameNS("*", "page")).map((page, index) => ({
    number: index + 1,
    paragraphs: descendantElements(page, ["p", "h"])
      .map((node) => node.textContent?.trim() ?? "")
      .filter(Boolean)
  }));
}

async function convertOpenDocumentText(arrayBuffer: ArrayBuffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const archive = await JSZip.loadAsync(arrayBuffer);
  const xml = await archive.file("content.xml")?.async("string");
  if (!xml) {
    throw new Error("ODT 文档中缺少 content.xml。");
  }
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const body = descendantElements(document, ["h", "p"]);
  return body.map((node) => {
    const text = escapeHtml(node.textContent?.trim() ?? "");
    if (!text) {
      return "";
    }
    return node.localName === "h" ? `<h2>${text}</h2>` : `<p>${text}</p>`;
  }).join("");
}

function descendantElements(root: ParentNode, localNames: string[]): Element[] {
  const allowedNames = new Set(localNames);
  return Array.from(root.querySelectorAll("*")).filter((node) => allowedNames.has(node.localName));
}

async function dataUrlToArrayBuffer(dataUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error("无法读取文件二进制内容。");
  }
  return response.arrayBuffer();
}

async function dataUrlToBlob(dataUrl: string, mimeType: string): Promise<Blob> {
  return new Blob([await dataUrlToArrayBuffer(dataUrl)], { type: mimeType });
}

function spreadsheetColumnLabel(columnIndex: number): string {
  let value = columnIndex + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function fileExtension(filePath: string): string {
  return filePath.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
}

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
