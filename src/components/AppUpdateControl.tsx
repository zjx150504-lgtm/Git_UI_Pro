import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Download,
  FileText,
  Github,
  History,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import packageInfo from "../../package.json";
import type { ReleaseHistoryItem, UpdateOperation, UpdatePhase, UpdateReleaseDetails, UpdateSource, UpdateState } from "../types/electron";
import { PathTooltip } from "./PathTooltip";

const TARGET_PHASES = new Set<UpdatePhase>(["available", "downloading", "downloaded", "installing"]);
const MOCK_PHASES = new Set<UpdatePhase>(["idle", "checking", "up-to-date", "available", "downloading", "downloaded", "error"]);
const CURRENT_VERSION = packageInfo.version;
const UPDATE_BRIDGE_UNAVAILABLE = "更新服务不可用：桌面进程未提供所需接口。";
const IS_MACOS = /Macintosh|Mac OS X/.test(window.navigator.userAgent);
type UpdateStateWithoutCapabilities = Omit<UpdateState, "capabilities">;

export function AppUpdateControl() {
  const mockState = useMemo(() => readMockUpdateState(), []);
  const isMock = mockState !== null;
  const [state, setState] = useState<UpdateState>(() => mockState ?? unsupportedUpdateState());
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [releaseDetails, setReleaseDetails] = useState<UpdateReleaseDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [historyItems, setHistoryItems] = useState<ReleaseHistoryItem[]>([]);
  const [selectedHistoryVersion, setSelectedHistoryVersion] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mockTimerRef = useRef<number>();
  const detailsCloseTimerRef = useRef<number>();
  const historyRequestRef = useRef(0);
  const detailsRequestRef = useRef(0);
  const detailsIdentityRef = useRef("");

  function setStateWithCapabilities(
    update: UpdateStateWithoutCapabilities | ((current: UpdateState) => UpdateStateWithoutCapabilities)
  ) {
    setState((current) => ({
      ...(typeof update === "function" ? update(current) : update),
      capabilities: current.capabilities
    }));
  }

  useEffect(() => {
    if (isMock) {
      return;
    }

    let cancelled = false;
    let receivedAuthoritativeState = false;
    const bridge = window.gitUI;
    if (!bridge?.getUpdateState) {
      setState((current) => ({ ...current, phase: "error", operation: "upgrade", error: UPDATE_BRIDGE_UNAVAILABLE }));
      return;
    }

    const unsubscribe = bridge.onUpdateState?.((nextState) => {
      if (!cancelled) {
        receivedAuthoritativeState = true;
        setState((current) => acceptAuthoritativeUpdateState(current, nextState));
      }
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (!cancelled) {
          receivedAuthoritativeState = true;
          setState((current) => acceptAuthoritativeUpdateState(current, nextState));
        }
      })
      .catch((error) => {
        if (!cancelled && !receivedAuthoritativeState) {
          setState((current) => ({ ...current, phase: "error", error: cleanActionError(error, "无法读取更新状态。") }));
        }
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [isMock]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      const clickedTrigger = triggerRef.current?.contains(target) ?? false;
      const clickedPanel = panelRef.current?.contains(target) ?? false;
      if (!clickedTrigger && !clickedPanel) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (detailsOpen) {
          setDetailsOpen(false);
        } else {
          closePanel();
        }
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, detailsOpen]);

  useEffect(() => {
    if (state.capabilities.rollback && open && historyExpanded && historyItems.length === 0 && !historyLoading && !historyError) {
      void loadReleaseHistory(false);
    }
  }, [state.capabilities.rollback, open, historyExpanded]);

  useEffect(
    () => () => {
      if (mockTimerRef.current !== undefined) {
        window.clearTimeout(mockTimerRef.current);
      }
      if (detailsCloseTimerRef.current !== undefined) {
        window.clearTimeout(detailsCloseTimerRef.current);
      }
    },
    []
  );

  const progressPercent = normalizedPercent(state.progress?.percent);
  const statusLabel = phaseLabel(state);
  const hasTarget = hasTargetVersion(state);
  const hasUpgradeNotification = state.operation === "upgrade" &&
    Boolean(state.availableVersion) &&
    stripVersionPrefix(state.availableVersion ?? "") !== stripVersionPrefix(state.currentVersion) &&
    (TARGET_PHASES.has(state.phase) || state.phase === "error");
  const triggerLabel = hasUpgradeNotification
    ? `发现新版本 v${stripVersionPrefix(state.availableVersion ?? state.currentVersion)}`
    : "关于、版本与更新";
  const updatesEnabled = state.capabilities.sources.length > 0;
  const canCheck = updatesEnabled && !actionPending && state.operation !== "rollback" && !["checking", "downloading", "downloaded", "installing"].includes(state.phase);
  const rollbackNeedsPreparation = state.operation === "rollback" && state.phase === "error" && !state.progress;
  const canChangeSource = state.capabilities.sources.length > 1 &&
    (!actionPending || state.phase === "checking") &&
    state.operation !== "rollback" &&
    !["downloading", "downloaded", "installing"].includes(state.phase);
  const detailVersion = stripVersionPrefix(hasTarget ? state.availableVersion ?? state.currentVersion : state.currentVersion);
  const detailHistoryItem = historyItems.find((item) => stripVersionPrefix(item.version) === detailVersion);
  const detailItems = releaseDetails?.contentSource === "compare"
    ? releaseDetails.commits.map((commit) => commit.title)
    : releaseDetails?.fallbackNotes ?? [];
  const detailReleaseDate = releaseDetails?.publishedAt || state.releaseDate || detailHistoryItem?.publishedAt;
  const detailCompareUrl = releaseDetails?.compareUrl;
  const detailsIdentity = `${state.source}:${detailVersion}`;

  useEffect(() => {
    if (detailsIdentityRef.current === detailsIdentity) {
      return;
    }
    detailsIdentityRef.current = detailsIdentity;
    detailsRequestRef.current += 1;
    setReleaseDetails(null);
    setDetailsLoading(false);
    setDetailsError("");
  }, [detailsIdentity]);

  useEffect(() => {
    if (!open || !detailsOpen) {
      return;
    }
    const loadedCurrentRange = releaseDetails?.source === state.source && releaseDetails.targetVersion === detailVersion;
    if (!loadedCurrentRange && !detailsLoading && !detailsError) {
      void loadReleaseDetails(false);
    }
  }, [open, detailsOpen, detailVersion, detailsLoading, detailsError, releaseDetails, state.source]);

  if (!isMock && IS_MACOS && !packageInfo.featureFlags.macosInAppUpdates) {
    return null;
  }

  function closePanel() {
    setDetailsOpen(false);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function showDetails() {
    if (detailsCloseTimerRef.current !== undefined) {
      window.clearTimeout(detailsCloseTimerRef.current);
      detailsCloseTimerRef.current = undefined;
    }
    setDetailsOpen(true);
  }

  function scheduleDetailsClose() {
    if (detailsCloseTimerRef.current !== undefined) {
      window.clearTimeout(detailsCloseTimerRef.current);
    }
    detailsCloseTimerRef.current = window.setTimeout(() => {
      setDetailsOpen(false);
      detailsCloseTimerRef.current = undefined;
    }, 140);
  }

  async function loadReleaseDetails(force: boolean) {
    const requestId = ++detailsRequestRef.current;
    setDetailsLoading(true);
    setDetailsError("");
    try {
      const details = isMock
        ? createMockReleaseDetails(detailVersion, state.source, state.releaseNotes)
        : await requireUpdateBridgeMethod(window.gitUI?.getUpdateReleaseDetails)(force);
      if (requestId !== detailsRequestRef.current) {
        return;
      }
      setReleaseDetails(details);
    } catch (error) {
      if (requestId === detailsRequestRef.current) {
        setReleaseDetails(null);
        setDetailsError(cleanActionError(error, `无法读取 v${detailVersion} 的版本变更。`));
      }
    } finally {
      if (requestId === detailsRequestRef.current) {
        setDetailsLoading(false);
      }
    }
  }

  async function loadReleaseHistory(force: boolean) {
    const requestId = ++historyRequestRef.current;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const items = isMock
        ? createMockReleaseHistory(state.currentVersion, state.source)
        : await requireUpdateBridgeMethod(window.gitUI?.listUpdateReleases)(force);
      if (requestId !== historyRequestRef.current) {
        return;
      }
      setHistoryItems(items);
      setSelectedHistoryVersion((current) => {
        if (current && items.some((item) => item.version === current)) {
          return current;
        }
        const preparedVersion = state.operation === "rollback" ? state.availableVersion : undefined;
        return preparedVersion && items.some((item) => item.version === preparedVersion) ? preparedVersion : "";
      });
    } catch (error) {
      if (requestId === historyRequestRef.current) {
        setHistoryError(cleanActionError(error, "无法读取历史版本，请稍后重试。"));
      }
    } finally {
      if (requestId === historyRequestRef.current) {
        setHistoryLoading(false);
      }
    }
  }

  async function checkForUpdates() {
    if (!canCheck) {
      return;
    }

    setActionPending(true);
    setHistoryError("");
    if (isMock) {
      setState((current) => ({ ...current, revision: current.revision + 1, phase: "checking", operation: "upgrade", error: undefined }));
      mockTimerRef.current = window.setTimeout(() => {
        setStateWithCapabilities((current) => ({
          revision: current.revision + 1,
          source: current.source,
          phase: "up-to-date",
          operation: "upgrade",
          currentVersion: current.currentVersion,
          availableVersion: current.currentVersion,
          releaseDate: new Date().toISOString(),
          releaseUrl: releaseUrlFor(current.currentVersion, current.source)
        }));
        setActionPending(false);
      }, 650);
      return;
    }

    try {
      if (!window.gitUI?.checkForUpdates) {
        throw new Error(UPDATE_BRIDGE_UNAVAILABLE);
      }
      const nextState = await window.gitUI.checkForUpdates();
      setState((current) => acceptAuthoritativeUpdateState(current, nextState));
    } catch (error) {
      setRecoverableError(error, "upgrade");
    } finally {
      setActionPending(false);
    }
  }

  async function cancelUpdateCheck() {
    if (state.phase !== "checking" || state.operation !== "upgrade") {
      return;
    }

    if (isMock) {
      if (mockTimerRef.current !== undefined) {
        window.clearTimeout(mockTimerRef.current);
        mockTimerRef.current = undefined;
      }
      setStateWithCapabilities((current) => ({
        revision: current.revision + 1,
        source: current.source,
        phase: "idle",
        operation: "upgrade",
        currentVersion: current.currentVersion
      }));
      setActionPending(false);
      return;
    }

    try {
      if (!window.gitUI?.cancelUpdateCheck) {
        throw new Error(UPDATE_BRIDGE_UNAVAILABLE);
      }
      const nextState = await window.gitUI.cancelUpdateCheck();
      setState((current) => acceptAuthoritativeUpdateState(current, nextState));
    } catch (error) {
      setRecoverableError(error, "upgrade");
    } finally {
      setActionPending(false);
    }
  }

  async function changeUpdateSource(source: UpdateSource) {
    if (!canChangeSource || source === state.source) {
      return;
    }

    setActionPending(true);
    historyRequestRef.current += 1;
    detailsRequestRef.current += 1;
    setHistoryItems([]);
    setReleaseDetails(null);
    setDetailsLoading(false);
    setDetailsError("");
    setHistoryLoading(false);
    setSelectedHistoryVersion("");
    setHistoryError("");
    if (isMock) {
      window.localStorage.setItem("git-ui-pro:update-source", source);
      setState((current) => ({
        ...current,
        revision: current.revision + 1,
        source,
        releaseUrl: releaseUrlFor(current.availableVersion ?? current.currentVersion, source),
        progress: current.progress ? {
          ...current.progress,
          sourceId: source,
          sourceLabel: source === "gitee" ? "Gitee 国内源" : "GitHub 更新源",
          sourceReleaseUrl: releaseUrlFor(current.availableVersion ?? current.currentVersion, source)
        } : undefined,
        error: undefined
      }));
      setHistoryItems(createMockReleaseHistory(state.currentVersion, source));
      setActionPending(false);
      return;
    }

    try {
      if (!window.gitUI?.setUpdateSource || !window.gitUI?.checkForUpdates) {
        throw new Error(UPDATE_BRIDGE_UNAVAILABLE);
      }
      const sourceState = await window.gitUI.setUpdateSource(source);
      setState((current) => acceptAuthoritativeUpdateState(current, sourceState));
      const checkedState = await window.gitUI.checkForUpdates();
      setState((current) => acceptAuthoritativeUpdateState(current, checkedState));
      void loadReleaseHistory(true);
    } catch (error) {
      setRecoverableError(error, "upgrade");
    } finally {
      setActionPending(false);
    }
  }

  async function prepareRollback(version = selectedHistoryVersion) {
    const selected = historyItems.find((item) => item.version === version);
    const alreadyPrepared = state.operation === "rollback" &&
      state.availableVersion === selected?.version &&
      (TARGET_PHASES.has(state.phase) || (state.phase === "error" && Boolean(state.progress)));
    if (!selected || actionPending || alreadyPrepared) {
      return;
    }

    setActionPending(true);
    setHistoryError("");
    if (isMock) {
      setStateWithCapabilities((current) => ({
        revision: current.revision + 1,
        source: current.source,
        phase: "available",
        operation: "rollback",
        currentVersion: current.currentVersion,
        availableVersion: selected.version,
        releaseName: selected.releaseName,
        releaseNotes: selected.releaseNotes,
        releaseDate: selected.publishedAt,
        releaseUrl: selected.releaseUrl
      }));
      setActionPending(false);
      return;
    }

    try {
      if (!window.gitUI?.prepareRollback) {
        throw new Error(UPDATE_BRIDGE_UNAVAILABLE);
      }
      const nextState = await window.gitUI.prepareRollback(selected.version);
      setState((current) => acceptAuthoritativeUpdateState(current, nextState));
    } catch (error) {
      setHistoryError(cleanActionError(error, "无法准备该回退版本。"));
    } finally {
      setActionPending(false);
    }
  }

  async function cancelRollback() {
    if (actionPending || state.phase === "installing") {
      return;
    }

    setActionPending(true);
    if (isMock) {
      if (mockTimerRef.current !== undefined) {
        window.clearTimeout(mockTimerRef.current);
        mockTimerRef.current = undefined;
      }
      setStateWithCapabilities((current) => ({
        revision: current.revision + 1,
        source: current.source,
        phase: "idle",
        operation: "upgrade",
        currentVersion: current.currentVersion
      }));
      setSelectedHistoryVersion("");
      setActionPending(false);
      return;
    }

    try {
      if (!window.gitUI?.cancelRollback) {
        throw new Error(UPDATE_BRIDGE_UNAVAILABLE);
      }
      const nextState = await window.gitUI.cancelRollback();
      setState((current) => acceptAuthoritativeUpdateState(current, nextState));
      setSelectedHistoryVersion("");
    } catch (error) {
      setRecoverableError(error, "rollback");
    } finally {
      setActionPending(false);
    }
  }

  async function downloadUpdate() {
    if (actionPending || state.phase === "downloading") {
      return;
    }

    setActionPending(true);
    if (isMock) {
      setState({
        ...state,
        revision: state.revision + 1,
        phase: "downloading",
        error: undefined,
        progress: { percent: 38, transferred: 31_876_324, total: 83_885_063, bytesPerSecond: 5_242_880 }
      });
      setActionPending(false);
      mockTimerRef.current = window.setTimeout(() => {
        setState((current) => ({
          ...current,
          revision: current.revision + 1,
          phase: "downloaded",
          progress: { percent: 100, transferred: 83_885_063, total: 83_885_063, bytesPerSecond: 0 }
        }));
      }, 900);
      return;
    }

    try {
      if (!window.gitUI?.downloadUpdate) {
        throw new Error(UPDATE_BRIDGE_UNAVAILABLE);
      }
      const nextState = await window.gitUI.downloadUpdate();
      setState((current) => acceptAuthoritativeUpdateState(current, nextState));
    } catch (error) {
      setRecoverableError(error, state.operation);
    } finally {
      setActionPending(false);
    }
  }

  async function cancelUpdateDownload() {
    if (actionPending || state.phase !== "downloading") {
      return;
    }

    setActionPending(true);
    if (isMock) {
      if (mockTimerRef.current !== undefined) {
        window.clearTimeout(mockTimerRef.current);
        mockTimerRef.current = undefined;
      }
      setState((current) => ({
        ...current,
        revision: current.revision + 1,
        phase: "available",
        progress: undefined,
        error: undefined
      }));
      setActionPending(false);
      return;
    }

    try {
      if (!window.gitUI?.cancelUpdateDownload) {
        throw new Error(UPDATE_BRIDGE_UNAVAILABLE);
      }
      const nextState = await window.gitUI.cancelUpdateDownload();
      setState((current) => acceptAuthoritativeUpdateState(current, nextState));
    } catch (error) {
      setRecoverableError(error, state.operation);
    } finally {
      setActionPending(false);
    }
  }

  async function installUpdate() {
    if (actionPending || state.phase !== "downloaded") {
      return;
    }

    setActionPending(true);
    if (isMock) {
      setState({ ...state, revision: state.revision + 1, phase: "installing", error: undefined });
      setActionPending(false);
      return;
    }

    try {
      if (!window.gitUI?.installUpdate) {
        throw new Error(UPDATE_BRIDGE_UNAVAILABLE);
      }
      const started = await window.gitUI.installUpdate();
      if (!started) {
        throw new Error("安装程序未能启动，请稍后重试。");
      }
    } catch (error) {
      setRecoverableError(error, state.operation);
      setActionPending(false);
    }
  }

  function setRecoverableError(error: unknown, operation: UpdateOperation) {
    const message = cleanActionError(error, "更新操作失败，请稍后重试。");
    setState((current) => ({ ...current, operation, phase: "error", error: message }));
  }

  function openRelease(url = state.releaseUrl || releaseUrlFor(state.currentVersion, state.source)) {
    if (isMock) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    if (!window.gitUI?.openExternal) {
      setRecoverableError(new Error(UPDATE_BRIDGE_UNAVAILABLE), state.operation);
      return;
    }
    void window.gitUI.openExternal(url).catch((error) => setRecoverableError(error, state.operation));
  }

  return (
    <div className="app-update-control">
      <PathTooltip content={triggerLabel} className="app-update-trigger-tooltip">
        <button
          ref={triggerRef}
          type="button"
          className="app-update-trigger"
          aria-label={hasUpgradeNotification ? `${triggerLabel}，打开关于与更新` : "打开关于、版本与更新"}
          aria-expanded={open}
          aria-controls="app-update-popover"
          data-phase={state.phase}
          data-operation={state.operation}
          data-update-notice={hasUpgradeNotification}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="app-update-trigger-label">关于</span>
          {hasUpgradeNotification ? <span className="app-update-trigger-dot" aria-hidden="true" /> : null}
        </button>
      </PathTooltip>

      {open ? (
        <div
          ref={panelRef}
          className="app-update-flyout"
          role="dialog"
          aria-modal={false}
          aria-labelledby="app-update-title"
          tabIndex={-1}
        >
          <div id="app-update-popover" className="app-update-popover">
          <div className="app-update-panel-header">
            <h2 id="app-update-title">当前版本</h2>
            <div className="app-update-header-actions">
              {state.capabilities.sources.length > 1 ? <div className="app-update-header-source-actions" role="radiogroup" aria-label="选择更新源">
                <PathTooltip content="使用 GitHub 更新源" className="app-update-action-tooltip">
                  <button
                    type="button"
                    className="app-update-icon-button app-update-source-icon"
                    role="radio"
                    aria-label="使用 GitHub 更新源"
                    aria-checked={state.source === "github"}
                    disabled={!canChangeSource}
                    onClick={() => void changeUpdateSource("github")}
                  >
                    <Github size={15} />
                  </button>
                </PathTooltip>
                {state.capabilities.sources.includes("gitee") ? <PathTooltip content="使用 Gitee 更新源" className="app-update-action-tooltip">
                  <button
                    type="button"
                    className="app-update-icon-button app-update-source-icon"
                    role="radio"
                    aria-label="使用 Gitee 更新源"
                    aria-checked={state.source === "gitee"}
                    disabled={!canChangeSource}
                    onClick={() => void changeUpdateSource("gitee")}
                  >
                    <Cloud size={15} />
                  </button>
                </PathTooltip> : null}
              </div> : null}
              {updatesEnabled ? <>
                <PathTooltip content="悬停查看本次更新内容" className="app-update-action-tooltip">
                  <button
                    type="button"
                    className="app-update-icon-button"
                    aria-label="查看本次更新内容"
                    aria-expanded={detailsOpen}
                    aria-controls="app-update-details"
                    onPointerEnter={showDetails}
                    onPointerLeave={scheduleDetailsClose}
                    onFocus={showDetails}
                    onBlur={scheduleDetailsClose}
                    onClick={showDetails}
                  >
                    <FileText size={15} />
                  </button>
                </PathTooltip>
                <PathTooltip content={state.phase === "checking" ? "取消检查" : "检查最新版本"} className="app-update-action-tooltip">
                  <button
                    type="button"
                    className="app-update-icon-button"
                    aria-label={state.phase === "checking" ? "取消检查" : "检查最新版本"}
                    disabled={state.phase !== "checking" && !canCheck}
                    onClick={state.phase === "checking" ? () => void cancelUpdateCheck() : () => void checkForUpdates()}
                  >
                    {state.phase === "checking" ? <X size={15} /> : <RefreshCw size={15} />}
                  </button>
                </PathTooltip>
              </> : null}
            </div>
          </div>

          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {hasTarget
              ? `${state.operation === "rollback" ? "回退" : "更新"}版本 v${stripVersionPrefix(state.availableVersion ?? state.currentVersion)}，${statusLabel}`
              : `当前版本 v${stripVersionPrefix(state.currentVersion)}，${statusLabel}`}
          </span>

          <div className="app-update-scroll-region">
            <section
              className="app-update-summary"
              data-has-target={hasTarget}
              data-operation={state.operation}
              aria-label={hasTarget
                ? `从 ${state.currentVersion} ${state.operation === "rollback" ? "回退" : "更新"}到 ${state.availableVersion}`
                : `当前版本 v${stripVersionPrefix(state.currentVersion)}`}
            >
              <div className="app-update-summary-current">
                <strong>v{stripVersionPrefix(state.currentVersion)}</strong>
                {!hasTarget ? <CheckCircle2 size={18} aria-hidden="true" /> : null}
              </div>
              <span className="app-update-summary-status">{hasTarget ? (state.operation === "rollback" ? "已选择回退版本" : "发现新版本") : statusLabel}</span>
              {hasTarget ? (
                <div className="app-update-summary-target">
                  <span>{state.operation === "rollback" ? "回退到" : "可更新至"}</span>
                  <strong>v{stripVersionPrefix(state.availableVersion ?? state.currentVersion)}</strong>
                </div>
              ) : null}
              <button type="button" className="app-update-release-link" onClick={() => openRelease()}>
                {state.source === "gitee" ? <Cloud size={14} aria-hidden="true" /> : <Github size={14} aria-hidden="true" />}
                查看发布
              </button>
            </section>

            {state.phase === "downloading" ? (
              <div className="app-update-progress" role="progressbar" aria-label="安装包下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
                <div className="app-update-progress-meta">
                  <strong>{progressPercent}%</strong>
                  <span>{formatBytes(state.progress?.transferred)} / {formatBytes(state.progress?.total)}</span>
                </div>
                <div className="app-update-progress-track"><span style={{ width: `${progressPercent}%` }} /></div>
                <div className="app-update-progress-detail">
                  <span className="app-update-progress-source">
                    {state.progress?.sourceLabel ?? "正在选择更新源"}
                    {state.progress?.resumed ? " · 断点续传" : ""}
                  </span>
                  {state.progress?.bytesPerSecond
                    ? <span className="app-update-progress-speed">{formatBytes(state.progress.bytesPerSecond)}/s</span>
                    : null}
                </div>
              </div>
            ) : null}

            {state.error ? (
              <div className="app-update-error" role="alert">
                <AlertTriangle size={15} />
                <span>{state.error}</span>
              </div>
            ) : null}

            {state.capabilities.rollback ? <section className="app-update-history" data-expanded={historyExpanded}>
              <PathTooltip content="仅显示带 SHA-256 校验的同类型正式版本" className="app-update-history-tooltip">
                <button
                  type="button"
                  className="app-update-history-toggle"
                  aria-label="历史版本，仅显示带 SHA-256 校验的同类型正式版本"
                  aria-expanded={historyExpanded}
                  aria-controls="app-update-history-body"
                  onClick={() => setHistoryExpanded((current) => !current)}
                >
                  <span className="app-update-history-heading">
                    <span className="app-update-history-title"><History size={16} /><strong>版本回退</strong></span>
                    <small>选择要回退到的版本（近 3 个版本）</small>
                  </span>
                  <ChevronDown size={16} />
                </button>
              </PathTooltip>

              <div id="app-update-history-body" className="app-update-history-body" hidden={!historyExpanded}>
                {historyExpanded ? <>
                  {historyLoading ? (
                    <div className="app-update-history-empty"><LoaderCircle className="app-update-spin" size={16} />正在读取历史版本</div>
                  ) : historyError ? (
                    <div className="app-update-history-error" role="alert">
                      <AlertTriangle size={14} /><span>{historyError}</span>
                      <PathTooltip content="重新读取历史版本" className="app-update-action-tooltip">
                        <button type="button" className="app-update-icon-button" aria-label="重新读取历史版本" onClick={() => void loadReleaseHistory(true)}><RefreshCw size={14} /></button>
                      </PathTooltip>
                    </div>
                  ) : historyItems.length > 0 ? (
                    <div className="app-update-history-list" role="radiogroup" aria-label="选择回退版本">
                      {historyItems.map((item) => (
                        <div className="app-update-history-item" key={item.version}>
                          <label className="app-update-history-choice">
                            <input
                              type="radio"
                              name="rollback-version"
                              value={item.version}
                              checked={selectedHistoryVersion === item.version}
                              onChange={() => {
                                setSelectedHistoryVersion(item.version);
                                void prepareRollback(item.version);
                              }}
                              disabled={actionPending || ["downloading", "downloaded", "installing"].includes(state.phase)}
                            />
                            <span className="app-update-history-radio" aria-hidden="true"><Check size={11} /></span>
                            <span className="app-update-history-meta"><strong>v{item.version}</strong><small>{formatReleaseDate(item.publishedAt)}</small></span>
                          </label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="app-update-history-empty"><History size={16} />暂无可安全回退的正式版本</div>
                  )}

                </> : null}
              </div>
            </section> : null}
          </div>

          {hasTarget || state.operation === "rollback" ? (
            <div className="app-update-actions">
              {state.phase === "downloading" ? (
                <button type="button" className="app-update-secondary" disabled={actionPending} onClick={() => void cancelUpdateDownload()}>
                  <X size={14} />取消下载
                </button>
              ) : state.operation === "rollback" ? (
                <button type="button" className="app-update-secondary" disabled={actionPending || state.phase === "installing"} onClick={() => void cancelRollback()}>
                  <X size={14} />取消
                </button>
              ) : null}
              {state.availableVersion && !rollbackNeedsPreparation ? (
                <button
                  type="button"
                  className="app-update-primary"
                  disabled={actionPending || state.phase === "checking" || state.phase === "downloading" || state.phase === "installing"}
                  onClick={state.phase === "downloaded" ? () => void installUpdate() : () => void downloadUpdate()}
                >
                  {state.phase === "downloaded" ? <PackageCheck size={16} /> : state.phase === "downloading" || state.phase === "installing" ? <LoaderCircle className="app-update-spin" size={16} /> : state.operation === "rollback" ? <RotateCcw size={16} /> : <Download size={16} />}
                  {primaryActionLabel(state, actionPending)}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

          {detailsOpen ? (
            <aside
              id="app-update-details"
              className="app-update-details-panel"
              aria-label="本次更新内容"
              onPointerEnter={showDetails}
              onPointerLeave={scheduleDetailsClose}
              onFocus={showDetails}
              onBlur={scheduleDetailsClose}
            >
              <div className="app-update-details-header">
                <span className="app-update-details-icon"><FileText size={15} /></span>
                 <div>
                   <strong>本次更新</strong>
                   <small>{detailsLoading
                     ? "正在比较正式版本"
                     : releaseDetails?.contentSource === "compare"
                       ? `${releaseDetails.totalCommits} 个提交`
                       : releaseDetails?.contentSource === "release"
                         ? "版本比较不可用，显示发布说明"
                         : "上一正式版到当前版本"}</small>
                 </div>
                <span className="app-update-details-source" data-source={state.source}>
                  {state.source === "gitee" ? <Cloud size={12} /> : <Github size={12} />}
                  {state.source === "gitee" ? "Gitee" : "GitHub"}
                </span>
               </div>

               <div className="app-update-details-version">
                 <div className="app-update-details-range">
                   <strong>{releaseDetails ? `v${releaseDetails.baseVersion}` : "上一版本"}</strong>
                   <ArrowRight size={14} aria-hidden="true" />
                   <strong>v{detailVersion}</strong>
                 </div>
                 <span>{detailReleaseDate ? formatReleaseDate(detailReleaseDate) : "发布时间待获取"}</span>
               </div>

               <div className="app-update-details-body">
                 {state.phase === "checking" || detailsLoading ? (
                   <div className="app-update-details-empty"><LoaderCircle className="app-update-spin" size={15} />正在读取版本区间内的提交</div>
                 ) : detailsError ? (
                   <div className="app-update-details-empty app-update-details-error" role="alert">
                     <AlertTriangle size={15} />
                     <span>{detailsError}</span>
                     <button type="button" onClick={() => void loadReleaseDetails(true)}>重试</button>
                   </div>
                 ) : detailItems.length > 0 ? (
                   <ol className="app-update-details-notes">
                     {detailItems.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}
                   </ol>
                 ) : (
                   <div className="app-update-details-empty">
                     <FileText size={15} />
                     <span>该版本区间没有可显示的提交记录。</span>
                   </div>
                 )}
               </div>

               <button type="button" className="app-update-details-release" disabled={!detailCompareUrl} onClick={() => openRelease(detailCompareUrl)}>
                 {state.source === "gitee" ? <Cloud size={13} /> : <Github size={13} />}
                 在 {state.source === "gitee" ? "Gitee" : "GitHub"} 查看完整版本差异
               </button>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function phaseLabel(state: UpdateState): string {
  const rollback = state.operation === "rollback";
  switch (state.phase) {
    case "unsupported":
      return "当前系统不支持应用内更新";
    case "idle":
      return "正式版";
    case "checking":
      return rollback ? "正在校验" : "正在检查更新";
    case "up-to-date":
      return "已是最新版本";
    case "downloading":
      return rollback ? "正在下载回退版本" : "正在下载更新";
    case "downloaded":
      return rollback ? "回退安装包已就绪" : "更新安装包已就绪";
    case "installing":
      return rollback ? "正在启动回退安装程序" : "正在启动更新安装程序";
    case "error":
      return rollback ? "回退未完成" : "更新未完成";
    default:
      return rollback ? "已选择" : "可更新";
  }
}

function primaryActionLabel(state: UpdateState, actionPending: boolean): string {
  if (state.phase === "checking") {
    return "正在校验";
  }
  if (state.phase === "downloading") {
    return "正在下载";
  }
  if (state.phase === "downloaded") {
    return actionPending ? "正在启动" : state.operation === "rollback" ? "打开回退安装程序" : "打开更新安装程序";
  }
  if (state.phase === "installing") {
    return "正在启动安装程序";
  }
  if (state.phase === "error") {
    return actionPending ? "正在重试" : state.operation === "rollback" ? "重新下载回退包" : "重新下载";
  }
  return actionPending ? "正在准备" : state.operation === "rollback" ? "下载回退版本" : "下载更新";
}

function hasTargetVersion(state: UpdateState): boolean {
  return Boolean(state.availableVersion) && (TARGET_PHASES.has(state.phase) || state.operation === "rollback" || state.phase === "error");
}

function unsupportedUpdateState(): UpdateState {
  return {
    revision: 0,
    source: storedUpdateSource(),
    capabilities: { sources: [], rollback: false },
    phase: "unsupported",
    operation: "upgrade",
    currentVersion: CURRENT_VERSION
  };
}

function requireUpdateBridgeMethod<T>(method: T | undefined): T {
  if (method === undefined) {
    throw new Error(UPDATE_BRIDGE_UNAVAILABLE);
  }
  return method;
}

function acceptAuthoritativeUpdateState(current: UpdateState, incoming: UpdateState): UpdateState {
  return incoming.revision >= current.revision ? incoming : current;
}

function normalizedPercent(percent: number | undefined): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.round(Math.min(100, Math.max(0, percent ?? 0)));
}

function formatBytes(bytes: number | undefined): string {
  if (!Number.isFinite(bytes) || !bytes || bytes <= 0) {
    return "--";
  }
  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatReleaseDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(timestamp);
}

function stripVersionPrefix(version: string): string {
  return version.replace(/^v/i, "");
}

function cleanActionError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "").trim() || fallback;
}

function releaseUrlFor(version: string, source: UpdateSource): string {
  const tagName = `v${stripVersionPrefix(version)}`;
  return source === "gitee"
    ? `https://gitee.com/zjx_master/git-ui-pro/releases/tag/${tagName}`
    : `https://github.com/zjx150504-lgtm/Git_UI_Pro/releases/tag/${tagName}`;
}

function createMockReleaseHistory(currentVersion: string, source: UpdateSource): ReleaseHistoryItem[] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(stripVersionPrefix(currentVersion));
  if (!match) {
    return [];
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return Array.from({ length: Math.min(3, patch) }, (_, index) => {
    const version = `${major}.${minor}.${patch - index - 1}`;
    return {
      version,
      tagName: `v${version}`,
      releaseName: `Git UI Pro v${version}`,
      releaseNotes: `1. Git UI Pro v${version} 正式版本\n2. 历史发布记录来自在线发行版`,
      publishedAt: new Date(Date.UTC(2026, 6, 23 - index * 4)).toISOString(),
      releaseUrl: releaseUrlFor(version, source),
      installerSize: 82_000_000 - index * 1_400_000
    };
  });
}

function createMockReleaseDetails(targetVersion: string, source: UpdateSource, releaseNotes: string | undefined): UpdateReleaseDetails {
  const baseVersion = decrementPatchVersion(targetVersion);
  const notes = releaseNoteItems(releaseNotes);
  return {
    source,
    baseVersion,
    targetVersion: stripVersionPrefix(targetVersion),
    publishedAt: new Date().toISOString(),
    releaseUrl: releaseUrlFor(targetVersion, source),
    compareUrl: compareUrlFor(baseVersion, targetVersion, source),
    commits: notes.map((title, index) => ({ sha: `mock-${index + 1}`, title })),
    totalCommits: notes.length,
    fallbackNotes: [],
    contentSource: "compare"
  };
}

function readMockUpdateState(): UpdateState | null {
  const params = new URLSearchParams(window.location.search);
  const rawPhase = params.get("mockUpdate");
  if (!rawPhase) {
    return null;
  }
  const phase = rawPhase === "current" ? "up-to-date" : rawPhase as UpdatePhase;
  if (!MOCK_PHASES.has(phase)) {
    return null;
  }

  const currentVersion = params.get("currentVersion")?.trim() || CURRENT_VERSION;
  const availableVersion = params.get("nextVersion")?.trim() || incrementPatchVersion(currentVersion);
  const requestedSource = params.get("updateSource");
  const source = requestedSource === "github" || requestedSource === "gitee" ? requestedSource : storedUpdateSource();
  const baseState: UpdateState = {
    revision: 0,
    source,
    capabilities: { sources: ["github", "gitee"], rollback: true },
    phase,
    operation: "upgrade",
    currentVersion,
    availableVersion: phase === "idle" || phase === "checking" ? undefined : phase === "up-to-date" ? currentVersion : availableVersion,
    releaseName: `Git UI Pro v${stripVersionPrefix(availableVersion)}`,
    releaseDate: "2026-07-31T12:00:00.000Z",
    releaseUrl: releaseUrlFor(phase === "up-to-date" ? currentVersion : availableVersion, source),
    releaseNotes: "1. 新增 Windows 正式版应用内更新入口\n2. 下载完成后可直接安装并重启软件\n3. 优化更新进度与失败重试反馈"
  };

  if (phase === "downloading") {
    baseState.progress = {
      percent: 64,
      transferred: 53_687_091,
      total: 83_885_063,
      bytesPerSecond: 5_242_880,
      sourceId: "gitee",
      sourceLabel: "Gitee 国内源",
      sourceReleaseUrl: baseState.releaseUrl,
      resumed: true
    };
  } else if (phase === "downloaded") {
    baseState.progress = { percent: 100, transferred: 83_885_063, total: 83_885_063, bytesPerSecond: 0 };
  } else if (phase === "error") {
    baseState.error = "下载连接已中断，请检查网络后重新下载。";
  }

  return baseState;
}

function incrementPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(stripVersionPrefix(version));
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : version;
}

function decrementPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(stripVersionPrefix(version));
  return match ? `${match[1]}.${match[2]}.${Math.max(0, Number(match[3]) - 1)}` : stripVersionPrefix(version);
}

function compareUrlFor(baseVersion: string, targetVersion: string, source: UpdateSource): string {
  const baseTag = `v${stripVersionPrefix(baseVersion)}`;
  const targetTag = `v${stripVersionPrefix(targetVersion)}`;
  return source === "gitee"
    ? `https://gitee.com/zjx_master/git-ui-pro/compare/${baseTag}...${targetTag}`
    : `https://github.com/zjx150504-lgtm/Git_UI_Pro/compare/${baseTag}...${targetTag}`;
}

function storedUpdateSource(): UpdateSource {
  try {
    return window.localStorage.getItem("git-ui-pro:update-source") === "gitee" ? "gitee" : "github";
  } catch {
    return "github";
  }
}

function releaseNoteItems(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim().replace(/^#{1,6}\s+/u, "").replace(/^(?:[-*+]\s+|\d+[.)]\s*)/u, ""))
    .filter((line) => Boolean(line) && !/^---+$/u.test(line))
    .slice(0, 20);
}
