import { app, autoUpdater as nativeAutoUpdater, net } from "electron";
import { MacUpdater, NsisUpdater, type ProgressInfo, type UpdateCheckResult, type UpdateInfo } from "electron-updater";
import type { CancellationToken } from "builder-util-runtime";
import type { EventEmitter } from "node:events";
import packageInfo from "../package.json";
import {
  buildReleaseHistoryCatalog,
  createRollbackUpdaterOptions,
  ReleaseHistoryCatalog,
  type ReleaseHistoryItem,
  type RollbackTarget
} from "./releaseHistory";
import {
  buildGiteeReleaseHistoryCatalog,
  parseGiteeReleaseSummary,
  parseLatestStableGiteeRelease,
  selectGiteeHistoryCandidates,
  verifyGiteeRelease,
  type GiteeReleaseSummary,
  type VerifiedGiteeRelease
} from "./giteeUpdateSource";
import { githubReleaseUrl, normalizeReleaseNotes, updateErrorMessage } from "./updateUtils";
import {
  cleanReleaseNoteItems,
  comparisonApiUrl,
  comparisonWebUrl,
  parseComparisonCommits,
  selectStableReleaseRange,
  type UpdateReleaseDetails
} from "./updateDetails";
import type { PortableRuntime } from "./portableRuntime";
import {
  buildPortableGiteeReleaseHistoryCatalog,
  buildPortableGithubReleaseHistoryCatalog,
  comparePortableVersions,
  downloadPortableUpdate,
  launchPortableUpdateHelper,
  parseLatestPortableGiteeRelease,
  parseLatestPortableGithubRelease,
  parsePortableGiteeReleaseIdentity,
  parsePortableGiteeReleaseSummary,
  PortableReleaseCatalog,
  portablePrimaryDownloadSource,
  selectPortableGiteeHistoryCandidates,
  verifyPortableGiteeRelease,
  type PortableGiteeReleaseSummary,
  type PortableUpdateTarget
} from "./portableUpdate";

export const UPDATE_CHECK_INITIAL_DELAY_MS = 8_000;
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1_000;
const RELEASE_HISTORY_CACHE_MS = 15 * 60 * 1_000;
const GITEE_RELEASE_HISTORY_URL = "https://gitee.com/api/v5/repos/zjx_master/git-ui-pro/releases?per_page=20";
const GITEE_LATEST_RELEASE_URL = "https://gitee.com/api/v5/repos/zjx_master/git-ui-pro/releases/latest";
const RELEASE_HISTORY_URL = "https://api.github.com/repos/zjx150504-lgtm/Git_UI_Pro/releases?per_page=20";
const LATEST_RELEASE_URL = "https://api.github.com/repos/zjx150504-lgtm/Git_UI_Pro/releases/latest";
const MAX_RELEASE_HISTORY_RESPONSE_LENGTH = 5_000_000;
const MAX_UPDATE_MANIFEST_RESPONSE_LENGTH = 64_000;
const GITEE_REQUEST_TIMEOUT_MS = 8_000;
const RELEASE_HISTORY_REQUEST_TIMEOUT_MS = 20_000;
const INSTALLER_LOW_SPEED_THRESHOLD_BYTES_PER_SECOND = 192 * 1024;
const INSTALLER_LOW_SPEED_GRACE_MS = 10_000;
const INSTALLER_LOW_SPEED_WINDOW_MS = 8_000;
const INSTALLER_STALL_TIMEOUT_MS = 20_000;
const SHA256_DIGEST_PATTERN = /^sha256:([a-f\d]{64})$/i;
const MAC_NATIVE_UPDATER_EVENTS = ["error", "update-downloaded"] as const;
export const MACOS_IN_APP_UPDATES_ENABLED = packageInfo.featureFlags.macosInAppUpdates === true;

type ReusableResource = {
  removeAllListeners(): unknown;
};

type MacNativeUpdaterEvent = (typeof MAC_NATIVE_UPDATER_EVENTS)[number];
type MacNativeUpdaterListener = Parameters<EventEmitter["removeListener"]>[1];

export type UpdatePhase =
  | "unsupported"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export type UpdateOperation = "upgrade" | "rollback";
export type UpdateSource = "github" | "gitee";

export type UpdateCapabilities = {
  sources: UpdateSource[];
  rollback: boolean;
};

export class ReusableInstance<T extends ReusableResource> {
  private instance: T | null = null;

  constructor(
    private readonly create: () => T,
    private readonly disposeExternal?: (instance: T) => void
  ) {}

  get(): T {
    this.instance ??= this.create();
    return this.instance;
  }

  current(): T | null {
    return this.instance;
  }

  dispose(): void {
    const instance = this.instance;
    if (!instance) {
      return;
    }

    this.instance = null;
    try {
      instance.removeAllListeners();
    } finally {
      this.disposeExternal?.(instance);
    }
  }
}

export function updateCapabilities(
  platform: NodeJS.Platform,
  packaged: boolean,
  macosInAppUpdatesEnabled = MACOS_IN_APP_UPDATES_ENABLED
): UpdateCapabilities {
  if (!packaged) {
    return { sources: [], rollback: false };
  }
  if (platform === "darwin") {
    return macosInAppUpdatesEnabled ? { sources: ["github"], rollback: false } : { sources: [], rollback: false };
  }
  if (platform === "win32") {
    return { sources: ["github", "gitee"], rollback: true };
  }
  return { sources: [], rollback: false };
}

export type UpdateProgress = {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
  sourceId?: "gitee" | "github";
  sourceLabel?: string;
  sourceReleaseUrl?: string;
  resumed?: boolean;
};

type UpdateProgressInput = Pick<ProgressInfo, "percent" | "transferred" | "total" | "bytesPerSecond">;

export type UpdateState = {
  revision: number;
  source: UpdateSource;
  capabilities: UpdateCapabilities;
  phase: UpdatePhase;
  operation: UpdateOperation;
  currentVersion: string;
  availableVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseDate?: string;
  releaseUrl?: string;
  progress?: UpdateProgress;
  error?: string;
};

type UpdateStateInput = Omit<UpdateState, "revision" | "source" | "capabilities"> & {
  revision?: number;
  source?: UpdateSource;
  capabilities?: UpdateCapabilities;
};

type UpgradeDownloadUpdater = {
  checkForUpdates: () => Promise<UpdateCheckResult | null>;
  downloadUpdate: (cancellationToken?: CancellationToken) => Promise<string[]>;
};

type UpgradeUpdaterPreferences = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  fullChangelog: boolean;
  disableWebInstaller: boolean;
  disableDifferentialDownload: boolean;
};

type InstallableNsisUpdater = {
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
};

export type LatestStableRelease = {
  version: string;
  tagName: string;
  target: RollbackTarget | PortableUpdateTarget | null;
};

type UpdateReleaseCatalog = ReleaseHistoryCatalog | PortableReleaseCatalog;

type InstallerDownloadSource = Readonly<{
  id: "github" | "gitee";
  label: string;
  target: RollbackTarget;
}>;

export type FreshUpgradeDownload = {
  info: UpdateInfo;
  downloadPromise: Promise<string[]> | null;
  cancellationToken: CancellationToken | null;
  cancelled?: boolean;
};

export class UpdateCheckGate<T> {
  private activeRequest: Promise<T> | null = null;

  getActiveRequest(): Promise<T> | null {
    return this.activeRequest;
  }

  run(task: () => Promise<T>): Promise<T> {
    if (this.activeRequest) {
      return this.activeRequest;
    }

    const request = Promise.resolve().then(task);
    this.activeRequest = request;
    void request.then(
      () => this.clear(request),
      () => this.clear(request)
    );
    return request;
  }

  cancel(): void {
    this.activeRequest = null;
  }

  private clear(request: Promise<T>): void {
    if (this.activeRequest === request) {
      this.activeRequest = null;
    }
  }
}

export type UpgradeCheckOutcome = {
  result: UpdateCheckResult;
  releaseUrl: string;
};

export async function runUpgradeCheck(
  updater: Pick<UpgradeDownloadUpdater, "checkForUpdates">,
  releaseUrl: (info: UpdateInfo) => string,
  loadLatestRelease?: () => Promise<LatestStableRelease>
): Promise<UpgradeCheckOutcome> {
  const result = loadLatestRelease
    ? await resolveFreshUpgradeCheck(updater, loadLatestRelease)
    : await updater.checkForUpdates();
  if (!result) {
    throw new Error("更新检查未返回结果，操作已停止。");
  }
  return { result, releaseUrl: releaseUrl(result.updateInfo) };
}

export function settleMacUpgradeDownload(
  downloadPromise: Promise<unknown>,
  isActive: () => boolean,
  isCurrentGeneration: () => boolean,
  reset: () => void,
  onError: (error: unknown) => void
): Promise<void> {
  return downloadPromise
    .then(() => undefined)
    .catch((error) => {
      if (isActive()) {
        reset();
        onError(error);
      }
    })
    .finally(() => {
      if (isCurrentGeneration()) {
        reset();
      }
    });
}

export async function resolveFreshUpgradeCheck(
  updater: Pick<UpgradeDownloadUpdater, "checkForUpdates">,
  loadLatestRelease: () => Promise<LatestStableRelease>
): Promise<UpdateCheckResult> {
  const latestRelease = await loadLatestRelease();
  const result = await updater.checkForUpdates();
  if (!result) {
    throw new Error("更新检查未返回结果，操作已停止。");
  }

  const updaterVersion = normalizeStableVersion(result.updateInfo.version);
  if (updaterVersion !== latestRelease.version) {
    throw new Error(
      `更新源最新正式版为 v${latestRelease.version}，但下载元数据仍为 v${updaterVersion ?? result.updateInfo.version}，操作已停止。`
    );
  }
  return result;
}

export async function startFreshUpgradeDownload(
  updater: UpgradeDownloadUpdater,
  loadLatestRelease: () => Promise<LatestStableRelease>,
  onCandidate: (info: UpdateInfo) => void,
  isActive: () => boolean = () => true
): Promise<FreshUpgradeDownload> {
  const result = await resolveFreshUpgradeCheck(updater, loadLatestRelease);
  if (!isActive()) {
    return { info: result.updateInfo, downloadPromise: null, cancellationToken: null, cancelled: true };
  }
  if (!result.isUpdateAvailable) {
    return { info: result.updateInfo, downloadPromise: null, cancellationToken: null };
  }

  onCandidate(result.updateInfo);
  return {
    info: result.updateInfo,
    downloadPromise: updater.downloadUpdate(result.cancellationToken),
    cancellationToken: result.cancellationToken ?? null
  };
}

export function configureUpgradeUpdater(updater: UpgradeUpdaterPreferences): void {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.fullChangelog = false;
  updater.disableWebInstaller = true;
  updater.disableDifferentialDownload = false;
}

export function restartAndInstallNsisUpdate(updater: InstallableNsisUpdater): void {
  updater.quitAndInstall(false, true);
}

export function parseLatestStableGithubRelease(value: unknown): LatestStableRelease {
  if (!value || typeof value !== "object") {
    throw new Error("GitHub 最新正式版数据格式无效。");
  }

  const release = value as {
    tag_name?: unknown;
    name?: unknown;
    body?: unknown;
    published_at?: unknown;
    draft?: unknown;
    prerelease?: unknown;
    assets?: unknown;
  };
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string") {
    throw new Error("GitHub latest 不是可用的正式版本。");
  }

  const version = normalizeStableVersion(release.tag_name);
  if (!version || release.tag_name !== `v${version}`) {
    throw new Error("GitHub latest 标签不是标准正式版本号。");
  }
  if (!Array.isArray(release.assets)) {
    throw new Error(`GitHub v${version} 缺少正式版安装资产。`);
  }

  const installerName = `Git-UI-Pro-Setup-${version}-x64.exe`;
  const expectedInstallerPath = `/zjx150504-lgtm/Git_UI_Pro/releases/download/${release.tag_name}/${installerName}`;
  let latestMetadataReady = false;
  let installerTarget: { downloadUrl: string; sha256: string } | null = null;
  for (const value of release.assets) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const asset = value as {
      name?: unknown;
      state?: unknown;
      size?: unknown;
      digest?: unknown;
      browser_download_url?: unknown;
    };
    const uploaded = asset.state === "uploaded" &&
      typeof asset.size === "number" &&
      Number.isSafeInteger(asset.size) &&
      asset.size > 0;
    if (!uploaded) {
      continue;
    }
    if (asset.name === "latest.yml") {
      latestMetadataReady = true;
      continue;
    }
    if (asset.name !== installerName || typeof asset.digest !== "string" || typeof asset.browser_download_url !== "string") {
      continue;
    }
    const digestMatch = SHA256_DIGEST_PATTERN.exec(asset.digest);
    const downloadUrl = parseExactGithubDownloadUrl(asset.browser_download_url, expectedInstallerPath);
    if (digestMatch && downloadUrl) {
      installerTarget = { downloadUrl, sha256: digestMatch[1].toLowerCase() };
    }
  }
  if (!latestMetadataReady || !installerTarget) {
    throw new Error(`GitHub v${version} 的 Windows 正式版资产尚未就绪。`);
  }

  if (typeof release.published_at !== "string") {
    throw new Error(`GitHub v${version} 缺少有效发布时间。`);
  }
  const publishedAt = new Date(release.published_at);
  if (Number.isNaN(publishedAt.getTime())) {
    throw new Error(`GitHub v${version} 的发布时间无效。`);
  }
  const releaseName = typeof release.name === "string" && release.name.trim()
    ? release.name.trim()
    : `Git UI Pro v${version}`;
  const releaseNotes = normalizeReleaseNotes(typeof release.body === "string" ? release.body : "");
  return {
    version,
    tagName: release.tag_name,
    target: {
      version,
      releaseName,
      releaseNotes,
      releaseDate: publishedAt.toISOString(),
      releaseUrl: githubReleaseUrl(version),
      downloadUrl: installerTarget.downloadUrl,
      sha256: installerTarget.sha256
    }
  };
}

function parseExactGithubDownloadUrl(value: string, expectedPath: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      url.pathname === expectedPath
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export class UpdateService {
  private state: UpdateState;
  private started = false;
  private backgroundCheckTimer: NodeJS.Timeout | null = null;
  private readonly updateCheckGate = new UpdateCheckGate<UpdateState>();
  private updateCheckGeneration = 0;
  private activeUpdateCheck: {
    generation: number;
    source: UpdateSource;
    controller: AbortController;
    kind: "check" | "download";
  } | null = null;
  private upgradeUpdater: NsisUpdater | null = null;
  // MacUpdater registers listeners on Electron's global autoUpdater, so reuse it for the service lifetime.
  private readonly macUpdater: ReusableInstance<MacUpdater> | null;
  private readonly macNativeListeners: Array<{
    event: MacNativeUpdaterEvent;
    listener: MacNativeUpdaterListener;
  }> = [];
  private macDownloadGeneration: number | null = null;
  private upgradeCancellationToken: CancellationToken | null = null;
  private upgradeGeneration = 0;
  private upgradeSource: InstallerDownloadSource | null = null;
  private upgradeFallbackSource: InstallerDownloadSource | null = null;
  private upgradeSourceStartedAt = 0;
  private upgradeLastProgressAt = 0;
  private upgradeLowSpeedSince = 0;
  private upgradeWatchdogTimer: NodeJS.Timeout | null = null;
  private rollbackUpdater: NsisUpdater | null = null;
  private rollbackCancellationToken: CancellationToken | null = null;
  private rollbackGeneration = 0;
  private rollbackTarget: RollbackTarget | null = null;
  private portableAbortController: AbortController | null = null;
  private portableTarget: PortableUpdateTarget | null = null;
  private portableStagedPath: string | null = null;
  private portableGeneration = 0;
  private releaseHistoryCatalog: UpdateReleaseCatalog | null = null;
  private releaseHistoryFetchedAt = 0;
  private releaseHistoryRequest: Promise<UpdateReleaseCatalog> | null = null;
  private releaseHistoryGeneration = 0;
  private releaseDetailsCache: { key: string; fetchedAt: number; value: UpdateReleaseDetails } | null = null;
  private releaseDetailsRequest: { key: string; value: Promise<UpdateReleaseDetails> } | null = null;
  private latestReleaseRequestSeed = 0;
  private readonly supported: boolean;
  private readonly portable: boolean;
  private readonly capabilities: UpdateCapabilities;

  constructor(
    private readonly onStateChange: (state: UpdateState) => void,
    private readonly portableRuntime: PortableRuntime = Object.freeze({
      isPortable: false,
      executablePath: null,
      dataPath: null,
      usedFallbackDataPath: false
    }),
    updateSource: UpdateSource = "github"
  ) {
    this.portable = portableRuntime.isPortable;
    this.capabilities = updateCapabilities(process.platform, app.isPackaged);
    this.supported = this.capabilities.sources.length > 0;
    const source = this.capabilities.sources.includes(updateSource) ? updateSource : this.capabilities.sources[0] ?? "github";
    this.state = {
      revision: 0,
      source,
      capabilities: cloneCapabilities(this.capabilities),
      phase: this.supported ? "idle" : "unsupported",
      operation: "upgrade",
      currentVersion: app.getVersion()
    };
    this.macUpdater = process.platform === "darwin" && this.supported
      ? new ReusableInstance(
          () => this.createBoundMacUpdater(),
          () => this.disposeMacNativeListeners()
        )
      : null;
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.emit();
    if (!this.supported) {
      return;
    }

    this.scheduleBackgroundCheck(UPDATE_CHECK_INITIAL_DELAY_MS);
  }

  stop(): void {
    this.started = false;
    if (this.backgroundCheckTimer) {
      clearTimeout(this.backgroundCheckTimer);
      this.backgroundCheckTimer = null;
    }
    this.cancelActiveUpdateCheck();
    this.disposeUpgradeUpdater();
    this.macUpdater?.dispose();
    this.rollbackCancellationToken?.cancel();
    this.rollbackCancellationToken = null;
    this.disposePortableDownload();
  }

  getState(): UpdateState {
    return cloneState(this.state);
  }

  setUpdateSource(source: UpdateSource): UpdateState {
    const nextSource = requireUpdateSource(source);
    if (!this.capabilities.sources.includes(nextSource)) {
      throw new Error("当前系统不支持该更新源。");
    }
    if (nextSource === this.state.source) {
      return this.getState();
    }
    if (this.state.operation === "rollback" || ["downloading", "downloaded", "installing"].includes(this.state.phase)) {
      throw new Error("当前更新操作尚未结束，暂时不能切换更新源。");
    }

    this.cancelActiveUpdateCheck();
    this.disposeUpgradeUpdater();
    this.disposePortableDownload();
    this.releaseHistoryGeneration += 1;
    this.releaseHistoryCatalog = null;
    this.releaseHistoryFetchedAt = 0;
    this.releaseHistoryRequest = null;
    this.releaseDetailsCache = null;
    this.releaseDetailsRequest = null;
    this.portableTarget = null;
    this.rollbackTarget = null;
    this.setState({
      source: nextSource,
      phase: this.supported ? "idle" : "unsupported",
      operation: "upgrade",
      currentVersion: this.state.currentVersion
    });
    return this.getState();
  }

  async getReleaseHistory(force = false): Promise<ReleaseHistoryItem[]> {
    if (!this.capabilities.rollback) {
      return [];
    }

    const catalog = await this.loadReleaseHistory(force);
    return catalog.entries.map((entry) => ({ ...entry }));
  }

  async getReleaseDetails(force = false): Promise<UpdateReleaseDetails> {
    const source = this.state.source;
    const targetVersion = normalizeStableVersion(this.state.availableVersion ?? this.state.currentVersion);
    if (!targetVersion) {
      throw new Error("当前正式版本号无效，无法读取版本变更。");
    }
    const key = `${source}:${targetVersion}`;
    if (!force && this.releaseDetailsCache?.key === key && Date.now() - this.releaseDetailsCache.fetchedAt < RELEASE_HISTORY_CACHE_MS) {
      return cloneReleaseDetails(this.releaseDetailsCache.value);
    }
    if (this.releaseDetailsRequest?.key === key) {
      return this.releaseDetailsRequest.value.then(cloneReleaseDetails);
    }

    const request = this.fetchReleaseDetails(source, targetVersion).then((details) => {
      if (this.state.source === source) {
        this.releaseDetailsCache = { key, fetchedAt: Date.now(), value: cloneReleaseDetails(details) };
      }
      return details;
    }).finally(() => {
      if (this.releaseDetailsRequest?.value === request) {
        this.releaseDetailsRequest = null;
      }
    });
    this.releaseDetailsRequest = { key, value: request };
    return request.then(cloneReleaseDetails);
  }

  checkForUpdates(): Promise<UpdateState> {
    const activeRequest = this.updateCheckGate.getActiveRequest();
    if (activeRequest) {
      return activeRequest;
    }

    if (
      !this.supported ||
      this.state.operation === "rollback" ||
      this.state.phase === "checking" ||
      this.state.phase === "downloading" ||
      this.state.phase === "downloaded" ||
      this.state.phase === "installing"
    ) {
      return Promise.resolve(this.getState());
    }

    return this.updateCheckGate.run(() => this.performUpdateCheck());
  }

  private async performUpdateCheck(): Promise<UpdateState> {
    const check = this.beginUpdateCheck();
    this.setState({
      phase: "checking",
      operation: "upgrade",
      currentVersion: this.state.currentVersion
    });
    try {
      if (this.portable) {
        const latestRelease = await this.fetchLatestStableRelease(check.source, check.controller.signal);
        if (!this.isActiveUpdateCheck(check)) {
          return this.getState();
        }
        if (comparePortableVersions(latestRelease.version, this.state.currentVersion) > 0) {
          const target = requirePortableTarget(latestRelease.target);
          this.portableTarget = target;
          this.portableStagedPath = null;
          this.setState(this.stateFromPortableTarget("available", target, "upgrade"));
        } else {
          const target = latestRelease.target && "artifactName" in latestRelease.target
            ? latestRelease.target
            : null;
          this.portableTarget = null;
          this.portableStagedPath = null;
          this.setState({
            phase: "up-to-date",
            operation: "upgrade",
            currentVersion: this.state.currentVersion,
            availableVersion: latestRelease.version,
            releaseName: target?.releaseName,
            releaseNotes: target?.releaseNotes,
            releaseDate: target?.releaseDate,
            releaseUrl: target?.releaseUrl
          });
        }
        return this.getState();
      }

      await this.performInstalledUpdateCheck(check);
    } catch (error) {
      if (this.isActiveUpdateCheck(check)) {
        this.setError(error, "upgrade");
      }
    } finally {
      this.completeUpdateCheck(check);
    }
    return this.getState();
  }

  private async performInstalledUpdateCheck(
    check: { generation: number; source: UpdateSource; controller: AbortController }
  ): Promise<void> {
    let checkUpdater: NsisUpdater | null = null;
    try {
      let outcome: UpgradeCheckOutcome;
      if (process.platform === "darwin") {
        outcome = await runUpgradeCheck(this.requireMacUpdater(), (info) => githubReleaseUrl(info.version));
      } else {
        const latestRelease = await this.fetchLatestStableRelease(check.source, check.controller.signal);
        if (!this.isActiveUpdateCheck(check)) {
          return;
        }
        const target = installerDownloadSources(requireRollbackTarget(latestRelease.target), check.source)[0].target;
        checkUpdater = this.createUpgradeUpdater(target);
        outcome = await runUpgradeCheck(
          checkUpdater,
          () => target.releaseUrl,
          async () => ({ ...latestRelease, target })
        );
      }
      if (!this.isActiveUpdateCheck(check)) {
        return;
      }
      const { result, releaseUrl } = outcome;
      if (result.isUpdateAvailable) {
        this.setState(this.stateFromInfo("available", result.updateInfo, "upgrade", releaseUrl));
      } else {
        this.setState({
          phase: "up-to-date",
          operation: "upgrade",
          currentVersion: this.state.currentVersion,
          availableVersion: result.updateInfo.version,
          releaseName: result.updateInfo.releaseName?.trim() || `Git UI Pro v${result.updateInfo.version}`,
          releaseNotes: normalizeReleaseNotes(result.updateInfo.releaseNotes),
          releaseDate: result.updateInfo.releaseDate,
          releaseUrl
        });
      }
    } finally {
      checkUpdater?.removeAllListeners();
    }
  }

  private scheduleBackgroundCheck(delayMs: number): void {
    if (!this.started || !this.supported) {
      return;
    }

    this.backgroundCheckTimer = setTimeout(() => {
      this.backgroundCheckTimer = null;
      void this.checkForUpdates().then(
        () => this.scheduleBackgroundCheck(UPDATE_CHECK_INTERVAL_MS),
        (error) => {
          console.error("后台更新检查异常", error);
          this.scheduleBackgroundCheck(UPDATE_CHECK_INTERVAL_MS);
        }
      );
    }, delayMs);
    this.backgroundCheckTimer.unref();
  }

  async prepareRollback(version: string): Promise<UpdateState> {
    if (!this.capabilities.rollback) {
      return this.getState();
    }
    if (["checking", "downloading", "downloaded", "installing"].includes(this.state.phase)) {
      throw new Error("当前更新操作尚未结束，请稍后再选择回退版本。");
    }

    const catalog = await this.loadReleaseHistory(false);
    const target = catalog.resolveTarget(version);
    if (!target) {
      throw new Error("所选版本不再可用，请刷新历史版本后重试。");
    }

    if (this.portable) {
      const portableTarget = requirePortableTarget(target);
      this.disposePortableDownload();
      this.portableTarget = portableTarget;
      this.setState(this.stateFromPortableTarget("available", portableTarget, "rollback"));
      return this.getState();
    }

    this.disposeRollbackUpdater();
    const rollbackSources = installerDownloadSources(target as RollbackTarget, this.state.source);
    const primaryTarget = rollbackSources[0].target;
    this.rollbackTarget = primaryTarget;
    const updater = this.createRollbackUpdater(primaryTarget);
    const generation = ++this.rollbackGeneration;
    this.rollbackUpdater = updater;
    this.bindRollbackUpdater(updater, generation);
    this.setState({
      phase: "checking",
      operation: "rollback",
      currentVersion: this.state.currentVersion,
      availableVersion: primaryTarget.version,
      releaseName: primaryTarget.releaseName,
      releaseNotes: primaryTarget.releaseNotes,
      releaseDate: primaryTarget.releaseDate,
      releaseUrl: primaryTarget.releaseUrl
    });

    try {
      const result = await updater.checkForUpdates();
      if (this.rollbackUpdater !== updater || generation !== this.rollbackGeneration) {
        return this.getState();
      }
      if (!result?.isUpdateAvailable || result.updateInfo.version !== primaryTarget.version) {
        throw new Error("无法确认所选回退版本，操作已停止。");
      }
      this.rollbackCancellationToken = result.cancellationToken ?? null;
    } catch (error) {
      if (this.rollbackUpdater === updater && generation === this.rollbackGeneration) {
        this.disposeRollbackUpdater();
        this.setState({
          phase: "error",
          operation: "rollback",
          currentVersion: this.state.currentVersion,
          availableVersion: primaryTarget.version,
          releaseName: primaryTarget.releaseName,
          releaseNotes: primaryTarget.releaseNotes,
          releaseDate: primaryTarget.releaseDate,
          releaseUrl: primaryTarget.releaseUrl,
          error: updateErrorMessage(error)
        });
      }
    }

    return this.getState();
  }

  cancelRollback(): UpdateState {
    if (this.state.operation !== "rollback" || this.state.phase === "installing") {
      return this.getState();
    }

    this.disposeRollbackUpdater();
    this.rollbackTarget = null;
    this.disposePortableDownload();
    this.setState({
      phase: this.supported ? "idle" : "unsupported",
      operation: "upgrade",
      currentVersion: this.state.currentVersion
    });
    return this.getState();
  }

  cancelUpdateCheck(): UpdateState {
    if (!this.supported || this.state.phase !== "checking" || this.state.operation !== "upgrade") {
      return this.getState();
    }

    const checkKind = this.activeUpdateCheck?.kind;
    this.cancelActiveUpdateCheck();
    if (checkKind === "download") {
      if (this.portable) {
        this.disposePortableDownload();
      } else {
        this.disposeUpgradeUpdater();
      }
    }
    this.setState({
      phase: "idle",
      operation: "upgrade",
      currentVersion: this.state.currentVersion
    });
    return this.getState();
  }

  cancelDownload(): UpdateState {
    if (!this.supported || this.state.phase !== "downloading") {
      return this.getState();
    }

    const cancelledState: UpdateStateInput = {
      ...this.state,
      phase: "available",
      progress: undefined,
      error: undefined
    };
    if (this.portable) {
      const target = this.portableTarget;
      this.portableGeneration += 1;
      this.portableAbortController?.abort();
      this.portableAbortController = null;
      this.portableStagedPath = null;
      this.portableTarget = target;
    } else if (this.state.operation === "rollback") {
      this.disposeRollbackUpdater();
    } else {
      this.disposeUpgradeUpdater();
    }
    this.setState(cancelledState);
    return this.getState();
  }

  async downloadUpdate(): Promise<UpdateState> {
    if (!this.supported || !["available", "error"].includes(this.state.phase)) {
      return this.getState();
    }

    if (this.portable) {
      if (this.state.operation === "upgrade") {
        return this.downloadLatestPortableUpgrade();
      }
      if (!this.portableTarget || this.portableTarget.version !== this.state.availableVersion) {
        this.setError(new Error("回退版本尚未通过校验，请重新选择该版本。"), "rollback");
        return this.getState();
      }
      return this.startPortableDownload(this.portableTarget, "rollback");
    }

    if (this.state.operation === "upgrade") {
      return this.downloadLatestUpgrade();
    }

    if (!this.state.availableVersion || !this.rollbackTarget) {
      this.setError(new Error("回退版本尚未通过校验，请重新选择该版本。"), "rollback");
      return this.getState();
    }

    if (!this.rollbackUpdater) {
      const selectedVersion = this.rollbackTarget.version;
      await this.prepareRollback(selectedVersion);
      if (!this.rollbackUpdater || this.state.phase !== "available") {
        return this.getState();
      }
    }

    this.setState({
      ...this.state,
      phase: "downloading",
      progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
      error: undefined
    });
    const updater = this.rollbackUpdater;
    void updater.downloadUpdate(this.rollbackCancellationToken ?? undefined).catch((error) => {
      if (this.rollbackUpdater !== updater) {
        return;
      }
      this.setError(error, "rollback");
    });
    return this.getState();
  }

  async installUpdate(): Promise<boolean> {
    if (!this.supported || this.state.phase !== "downloaded") {
      return false;
    }

    if (this.portable) {
      if (!this.portableTarget || !this.portableStagedPath) {
        this.setError(new Error("Portable 更新包已失效，请重新下载。"), this.state.operation);
        return false;
      }
      try {
        await launchPortableUpdateHelper({
          runtime: this.portableRuntime,
          userDataPath: app.getPath("userData"),
          stagedPath: this.portableStagedPath,
          target: this.portableTarget
        });
      } catch (error) {
        this.setError(error, this.state.operation);
        return false;
      }
      this.setState({ ...this.state, phase: "installing", error: undefined });
      setImmediate(() => app.quit());
      return true;
    }

    const updater = this.state.operation === "rollback"
      ? this.rollbackUpdater
      : process.platform === "darwin"
        ? this.macUpdater?.current() ?? null
        : this.upgradeUpdater;
    if (!updater) {
      const operation = this.state.operation;
      const packageName = operation === "rollback" ? "回退安装包" : "更新安装包";
      this.setError(new Error(`${packageName}已失效，请重新下载。`), operation);
      return false;
    }

    this.setState({ ...this.state, phase: "installing", error: undefined });
    setImmediate(() => {
      if (updater instanceof MacUpdater) {
        // MacUpdater exposes a zero-argument API; silent and force-run flags only apply to Windows installers.
        updater.quitAndInstall();
      } else {
        restartAndInstallNsisUpdate(updater);
      }
    });
    return true;
  }

  private createBoundMacUpdater(): MacUpdater {
    const listenersBefore = new Map(
      MAC_NATIVE_UPDATER_EVENTS.map((event) => [
        event,
        new Set(nativeAutoUpdater.listeners(event) as MacNativeUpdaterListener[])
      ])
    );
    let updater: MacUpdater | null = null;
    try {
      updater = this.createMacUpdater();
      for (const event of MAC_NATIVE_UPDATER_EVENTS) {
        const existingListeners = listenersBefore.get(event);
        for (const listener of nativeAutoUpdater.listeners(event) as MacNativeUpdaterListener[]) {
          if (!existingListeners?.has(listener)) {
            this.macNativeListeners.push({ event, listener });
          }
        }
      }
      this.bindMacUpgradeUpdater(updater);
      return updater;
    } catch (error) {
      updater?.removeAllListeners();
      this.disposeMacNativeListeners();
      throw error;
    }
  }

  private disposeMacNativeListeners(): void {
    for (const { event, listener } of this.macNativeListeners.splice(0)) {
      (nativeAutoUpdater as EventEmitter).removeListener(event, listener);
    }
  }

  private createMacUpdater(): MacUpdater {
    const updater = new MacUpdater({
      provider: "github",
      owner: "zjx150504-lgtm",
      repo: "Git_UI_Pro"
    });
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.fullChangelog = false;
    updater.disableDifferentialDownload = false;
    updater.logger = console;
    return updater;
  }

  private requireMacUpdater(): MacUpdater {
    if (!this.macUpdater) {
      throw new Error("当前系统不支持 macOS 应用内更新。");
    }
    return this.macUpdater.get();
  }

  private createUpgradeUpdater(target: RollbackTarget): NsisUpdater {
    const updater = new NsisUpdater(createRollbackUpdaterOptions(target) as any);
    configureUpgradeUpdater(updater);
    updater.logger = console;
    return updater;
  }

  private bindUpgradeUpdater(
    updater: NsisUpdater,
    generation: number,
    source: InstallerDownloadSource,
    fallbackSource: InstallerDownloadSource | null
  ): void {
    const isActive = () => this.upgradeUpdater === updater && this.upgradeGeneration === generation;
    updater.on("download-progress", (progress) => {
      if (isActive()) {
        this.recordUpgradeProgress(updater, generation, progress);
        if (!isActive()) {
          return;
        }
        this.setState({
          ...this.state,
          phase: "downloading",
          releaseUrl: source.target.releaseUrl,
          progress: normalizeProgress(progress, source),
          error: undefined
        });
      }
    });
    updater.on("update-downloaded", (info) => {
      if (isActive()) {
        this.clearUpgradeWatchdog();
        this.setState({
          ...this.stateFromInfo("downloaded", info, "upgrade", source.target.releaseUrl),
          progress: this.state.progress
        });
      }
    });
    updater.on("update-cancelled", () => {
      if (isActive()) {
        void this.handleUpgradeSourceFailure(updater, generation, fallbackSource, new Error(`${source.label}下载被中断。`));
      }
    });
    updater.on("error", (error) => {
      if (isActive()) {
        void this.handleUpgradeSourceFailure(updater, generation, fallbackSource, error);
      }
    });
  }

  private async startUpgradeDownloadAttempt(
    source: InstallerDownloadSource,
    fallbackSource: InstallerDownloadSource | null,
    expectedVersion: string,
    isCheckActive: () => boolean = () => true
  ): Promise<void> {
    const updater = this.createUpgradeUpdater(source.target);
    const generation = ++this.upgradeGeneration;
    this.upgradeUpdater = updater;
    this.upgradeSource = source;
    this.upgradeFallbackSource = fallbackSource;
    this.bindUpgradeUpdater(updater, generation, source, fallbackSource);

    try {
      const freshDownload = await startFreshUpgradeDownload(
        updater,
        async () => ({ version: expectedVersion, tagName: `v${expectedVersion}`, target: source.target }),
        (info) => {
          if (!isCheckActive() || this.upgradeUpdater !== updater || this.upgradeGeneration !== generation) {
            return;
          }
          this.upgradeSourceStartedAt = Date.now();
          this.upgradeLastProgressAt = this.upgradeSourceStartedAt;
          this.upgradeLowSpeedSince = 0;
          this.armUpgradeWatchdog(updater, generation, fallbackSource);
          this.setState({
            ...this.stateFromInfo("available", info, "upgrade", source.target.releaseUrl),
            phase: "downloading",
            progress: emptyInstallerProgress(source),
            error: undefined
          });
        },
        isCheckActive
      );
      if (!isCheckActive() || this.upgradeUpdater !== updater || this.upgradeGeneration !== generation || freshDownload.cancelled) {
        this.disposeUpgradeUpdater();
        return;
      }
      this.upgradeCancellationToken = freshDownload.cancellationToken;
      if (!freshDownload.downloadPromise) {
        this.disposeUpgradeUpdater();
        this.setState({
          phase: "up-to-date",
          operation: "upgrade",
          currentVersion: this.state.currentVersion,
          availableVersion: freshDownload.info.version,
          releaseName: freshDownload.info.releaseName?.trim() || `Git UI Pro v${freshDownload.info.version}`,
          releaseNotes: normalizeReleaseNotes(freshDownload.info.releaseNotes),
          releaseDate: freshDownload.info.releaseDate,
          releaseUrl: source.target.releaseUrl
        });
        return;
      }
      void freshDownload.downloadPromise.catch((error) => {
        void this.handleUpgradeSourceFailure(updater, generation, fallbackSource, error);
      });
    } catch (error) {
      await this.handleUpgradeSourceFailure(updater, generation, fallbackSource, error);
    }
  }

  private async handleUpgradeSourceFailure(
    updater: NsisUpdater,
    generation: number,
    fallbackSource: InstallerDownloadSource | null,
    error: unknown
  ): Promise<void> {
    if (this.upgradeUpdater !== updater || this.upgradeGeneration !== generation) {
      return;
    }
    this.disposeUpgradeUpdater();
    if (!fallbackSource) {
      this.setError(error, "upgrade");
      return;
    }
    this.setState({
      ...this.state,
      phase: "downloading",
      releaseUrl: fallbackSource.target.releaseUrl,
      progress: emptyInstallerProgress(fallbackSource),
      error: undefined
    });
    await this.startUpgradeDownloadAttempt(fallbackSource, null, fallbackSource.target.version);
  }

  private recordUpgradeProgress(updater: NsisUpdater, generation: number, progress: ProgressInfo): void {
    if (!this.upgradeFallbackSource || this.upgradeUpdater !== updater || this.upgradeGeneration !== generation) {
      return;
    }
    const now = Date.now();
    this.upgradeLastProgressAt = now;
    if (now - this.upgradeSourceStartedAt < INSTALLER_LOW_SPEED_GRACE_MS) {
      return;
    }
    if (progress.bytesPerSecond >= INSTALLER_LOW_SPEED_THRESHOLD_BYTES_PER_SECOND) {
      this.upgradeLowSpeedSince = 0;
      return;
    }
    if (this.upgradeLowSpeedSince === 0) {
      this.upgradeLowSpeedSince = now;
      return;
    }
    if (now - this.upgradeLowSpeedSince >= INSTALLER_LOW_SPEED_WINDOW_MS) {
      void this.handleUpgradeSourceFailure(
        updater,
        generation,
        this.upgradeFallbackSource,
        new Error(`${this.upgradeSource?.label ?? "当前更新源"}持续低速，已自动切换备用源。`)
      );
    }
  }

  private armUpgradeWatchdog(
    updater: NsisUpdater,
    generation: number,
    fallbackSource: InstallerDownloadSource | null
  ): void {
    this.clearUpgradeWatchdog();
    if (!fallbackSource) {
      return;
    }
    this.upgradeWatchdogTimer = setInterval(() => {
      if (
        this.upgradeUpdater === updater &&
        this.upgradeGeneration === generation &&
        Date.now() - this.upgradeLastProgressAt >= INSTALLER_STALL_TIMEOUT_MS
      ) {
        void this.handleUpgradeSourceFailure(
          updater,
          generation,
          fallbackSource,
          new Error(`${this.upgradeSource?.label ?? "当前更新源"}长时间没有下载进度，已自动切换备用源。`)
        );
      }
    }, 2_000);
    this.upgradeWatchdogTimer.unref();
  }

  private clearUpgradeWatchdog(): void {
    if (this.upgradeWatchdogTimer) {
      clearInterval(this.upgradeWatchdogTimer);
      this.upgradeWatchdogTimer = null;
    }
  }

  private async downloadLatestUpgrade(): Promise<UpdateState> {
    const check = this.beginUpdateCheck("download");
    this.setState({
      phase: "checking",
      operation: "upgrade",
      currentVersion: this.state.currentVersion
    });

    if (process.platform === "darwin") {
      try {
        this.disposeUpgradeUpdater();
        const updater = this.requireMacUpdater();
        const generation = ++this.upgradeGeneration;
        const result = await updater.checkForUpdates();
        if (!this.isActiveUpdateCheck(check) || this.upgradeGeneration !== generation) {
          return this.getState();
        }
        if (!result) {
          throw new Error("更新检查未返回结果，操作已停止。");
        }
        if (!result.isUpdateAvailable) {
          this.disposeUpgradeUpdater();
          this.setState({
            phase: "up-to-date",
            operation: "upgrade",
            currentVersion: this.state.currentVersion,
            availableVersion: result.updateInfo.version,
            releaseName: result.updateInfo.releaseName?.trim() || `Git UI Pro v${result.updateInfo.version}`,
            releaseNotes: normalizeReleaseNotes(result.updateInfo.releaseNotes),
            releaseDate: result.updateInfo.releaseDate,
            releaseUrl: githubReleaseUrl(result.updateInfo.version)
          });
          return this.getState();
        }
        this.upgradeCancellationToken = result.cancellationToken ?? null;
        this.macDownloadGeneration = generation;
        this.setState({
          ...this.stateFromInfo("available", result.updateInfo, "upgrade"),
          phase: "downloading",
          progress: macUpdateProgress(
            { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 },
            githubReleaseUrl(result.updateInfo.version)
          ),
          error: undefined
        });
        const isActive = () => this.macDownloadGeneration === generation && this.upgradeGeneration === generation;
        const isCurrentGeneration = () => this.upgradeGeneration === generation;
        const reset = () => {
          this.macDownloadGeneration = null;
          this.upgradeCancellationToken = null;
        };
        void settleMacUpgradeDownload(
          updater.downloadUpdate(result.cancellationToken),
          isActive,
          isCurrentGeneration,
          reset,
          (error) => this.setError(error, "upgrade")
        );
      } catch (error) {
        if (this.isActiveUpdateCheck(check)) {
          this.disposeUpgradeUpdater();
          this.setError(error, "upgrade");
        }
      } finally {
        this.completeUpdateCheck(check);
      }
      return this.getState();
    }

    try {
      this.disposeUpgradeUpdater();
      const latestRelease = await this.fetchLatestStableRelease(check.source, check.controller.signal);
      if (!this.isActiveUpdateCheck(check)) {
        return this.getState();
      }
      const sources = installerDownloadSources(requireRollbackTarget(latestRelease.target), this.state.source);
      await this.startUpgradeDownloadAttempt(sources[0], null, latestRelease.version, () => this.isActiveUpdateCheck(check));
    } catch (error) {
      if (this.isActiveUpdateCheck(check)) {
        this.disposeUpgradeUpdater();
        this.setError(error, "upgrade");
      }
    } finally {
      this.completeUpdateCheck(check);
    }
    return this.getState();
  }

  private bindMacUpgradeUpdater(updater: MacUpdater): void {
    const isActive = () => this.macDownloadGeneration !== null && this.macDownloadGeneration === this.upgradeGeneration;
    updater.on("download-progress", (progress) => {
      if (isActive()) {
        this.setState({
          ...this.state,
          phase: "downloading",
          progress: macUpdateProgress(progress, this.state.releaseUrl),
          error: undefined
        });
      }
    });
    updater.on("update-downloaded", (info) => {
      if (isActive()) {
        this.macDownloadGeneration = null;
        this.upgradeCancellationToken = null;
        this.setState({
          ...this.stateFromInfo("downloaded", info, "upgrade"),
          progress: this.state.progress
        });
      }
    });
    updater.on("update-cancelled", () => {
      if (isActive()) {
        this.macDownloadGeneration = null;
        this.upgradeCancellationToken = null;
        this.setError(new Error("更新包下载已取消。"), "upgrade");
      }
    });
    updater.on("error", (error) => {
      if (isActive()) {
        this.macDownloadGeneration = null;
        this.upgradeCancellationToken = null;
        this.setError(error, "upgrade");
      }
    });
  }

  private async downloadLatestPortableUpgrade(): Promise<UpdateState> {
    const check = this.beginUpdateCheck("download");
    this.setState({
      phase: "checking",
      operation: "upgrade",
      currentVersion: this.state.currentVersion
    });
    try {
      this.disposePortableDownload();
      const latestRelease = await this.fetchLatestStableRelease(check.source, check.controller.signal);
      if (!this.isActiveUpdateCheck(check)) {
        return this.getState();
      }
      if (comparePortableVersions(latestRelease.version, this.state.currentVersion) <= 0) {
        const target = latestRelease.target && "artifactName" in latestRelease.target
          ? latestRelease.target
          : null;
        this.setState({
          phase: "up-to-date",
          operation: "upgrade",
          currentVersion: this.state.currentVersion,
          availableVersion: latestRelease.version,
          releaseName: target?.releaseName,
          releaseNotes: target?.releaseNotes,
          releaseDate: target?.releaseDate,
          releaseUrl: target?.releaseUrl
        });
        return this.getState();
      }
      const target = requirePortableTarget(latestRelease.target);
      return this.startPortableDownload(target, "upgrade");
    } catch (error) {
      if (this.isActiveUpdateCheck(check)) {
        this.setError(error, "upgrade");
      }
      return this.getState();
    } finally {
      this.completeUpdateCheck(check);
    }
  }

  private startPortableDownload(
    target: PortableUpdateTarget,
    operation: UpdateOperation,
    additionalTarget?: Promise<PortableUpdateTarget | null>
  ): UpdateState {
    this.disposePortableDownload();
    const controller = new AbortController();
    const generation = ++this.portableGeneration;
    this.portableAbortController = controller;
    this.portableTarget = target;
    this.portableStagedPath = null;
    const primarySource = portablePrimaryDownloadSource(target);
    this.setState({
      ...this.stateFromPortableTarget("available", target, operation),
      phase: "downloading",
      progress: {
        percent: 0,
        transferred: 0,
        total: target.size,
        bytesPerSecond: 0,
        sourceId: primarySource.id,
        sourceLabel: primarySource.label,
        sourceReleaseUrl: primarySource.releaseUrl,
        resumed: false
      },
      error: undefined
    });

    void downloadPortableUpdate(target, this.portableRuntime, controller.signal, (progress) => {
      if (generation !== this.portableGeneration || this.portableTarget !== target) {
        return;
      }
      this.setState({
        ...this.state,
        phase: "downloading",
        releaseUrl: progress.sourceReleaseUrl ?? this.state.releaseUrl,
        progress: { ...progress },
        error: undefined
      });
    }, { additionalTarget }).then(
      (stagedPath) => {
        if (generation !== this.portableGeneration || this.portableTarget !== target) {
          return;
        }
        this.portableAbortController = null;
        this.portableStagedPath = stagedPath;
        this.setState({
          ...this.stateFromPortableTarget("downloaded", target, operation),
          releaseUrl: this.state.releaseUrl ?? target.releaseUrl,
          progress: {
            percent: 100,
            transferred: target.size,
            total: target.size,
            bytesPerSecond: 0,
            sourceId: this.state.progress?.sourceId,
            sourceLabel: this.state.progress?.sourceLabel,
            sourceReleaseUrl: this.state.progress?.sourceReleaseUrl,
            resumed: this.state.progress?.resumed
          }
        });
      },
      (error) => {
        if (generation !== this.portableGeneration || this.portableTarget !== target) {
          return;
        }
        this.portableAbortController = null;
        this.setError(error, operation);
      }
    );
    return this.getState();
  }

  private createRollbackUpdater(target: RollbackTarget): NsisUpdater {
    const updater = new NsisUpdater(createRollbackUpdaterOptions(target) as any);
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = true;
    updater.fullChangelog = false;
    updater.disableWebInstaller = true;
    updater.disableDifferentialDownload = false;
    updater.logger = console;
    return updater;
  }

  private bindRollbackUpdater(updater: NsisUpdater, generation: number): void {
    const isActive = () => this.rollbackUpdater === updater && this.rollbackGeneration === generation;
    updater.on("checking-for-update", () => {
      if (isActive()) {
        this.setState({ ...this.state, phase: "checking", operation: "rollback", error: undefined });
      }
    });
    updater.on("update-available", (info) => {
      if (isActive()) {
        this.setState(this.stateFromInfo("available", info, "rollback", this.state.releaseUrl));
      }
    });
    updater.on("update-not-available", () => {
      if (isActive()) {
        this.setError(new Error("所选版本无法用于回退。"), "rollback");
      }
    });
    updater.on("download-progress", (progress) => {
      if (isActive()) {
        this.setState({ ...this.state, phase: "downloading", operation: "rollback", progress: normalizeProgress(progress), error: undefined });
      }
    });
    updater.on("update-downloaded", (info) => {
      if (isActive()) {
        this.setState({
          ...this.stateFromInfo("downloaded", info, "rollback", this.state.releaseUrl),
          progress: this.state.progress
        });
      }
    });
    updater.on("update-cancelled", () => {
      if (isActive()) {
        this.setError(new Error("回退安装包下载已取消。"), "rollback");
      }
    });
    updater.on("error", (error) => {
      if (isActive()) {
        this.setError(error, "rollback");
      }
    });
  }

  private disposeUpgradeUpdater(): void {
    this.upgradeGeneration += 1;
    this.macDownloadGeneration = null;
    this.clearUpgradeWatchdog();
    this.upgradeCancellationToken?.cancel();
    this.upgradeCancellationToken = null;
    this.upgradeUpdater?.removeAllListeners();
    this.upgradeUpdater = null;
    this.upgradeSource = null;
    this.upgradeFallbackSource = null;
    this.upgradeSourceStartedAt = 0;
    this.upgradeLastProgressAt = 0;
    this.upgradeLowSpeedSince = 0;
  }

  private disposeRollbackUpdater(): void {
    this.rollbackGeneration += 1;
    this.rollbackCancellationToken?.cancel();
    this.rollbackCancellationToken = null;
    this.rollbackUpdater?.removeAllListeners();
    this.rollbackUpdater = null;
  }

  private disposePortableDownload(): void {
    this.portableGeneration += 1;
    this.portableAbortController?.abort();
    this.portableAbortController = null;
    this.portableStagedPath = null;
    this.portableTarget = null;
  }

  private beginUpdateCheck(kind: "check" | "download" = "check"): {
    generation: number;
    source: UpdateSource;
    controller: AbortController;
    kind: "check" | "download";
  } {
    this.activeUpdateCheck?.controller.abort();
    const check = {
      generation: ++this.updateCheckGeneration,
      source: this.state.source,
      controller: new AbortController(),
      kind
    };
    this.activeUpdateCheck = check;
    return check;
  }

  private isActiveUpdateCheck(check: { generation: number; source: UpdateSource }): boolean {
    return this.activeUpdateCheck?.generation === check.generation &&
      this.activeUpdateCheck.source === check.source &&
      this.state.source === check.source;
  }

  private completeUpdateCheck(check: { generation: number }): void {
    if (this.activeUpdateCheck?.generation === check.generation) {
      this.activeUpdateCheck = null;
    }
  }

  private cancelActiveUpdateCheck(): void {
    this.updateCheckGeneration += 1;
    this.activeUpdateCheck?.controller.abort();
    this.activeUpdateCheck = null;
    this.updateCheckGate.cancel();
  }

  private async loadReleaseHistory(force: boolean): Promise<UpdateReleaseCatalog> {
    if (!force && this.releaseHistoryCatalog && Date.now() - this.releaseHistoryFetchedAt < RELEASE_HISTORY_CACHE_MS) {
      return this.releaseHistoryCatalog;
    }
    if (this.releaseHistoryRequest) {
      return this.releaseHistoryRequest;
    }

    const generation = this.releaseHistoryGeneration;
    const request = this.fetchReleaseHistory().then((catalog) => {
      if (generation === this.releaseHistoryGeneration) {
        this.releaseHistoryCatalog = catalog;
        this.releaseHistoryFetchedAt = Date.now();
      }
      return catalog;
    }).finally(() => {
      if (this.releaseHistoryRequest === request) {
        this.releaseHistoryRequest = null;
      }
    });
    this.releaseHistoryRequest = request;
    return request;
  }

  private async fetchLatestStableRelease(
    source: UpdateSource = this.state.source,
    signal?: AbortSignal
  ): Promise<LatestStableRelease> {
    return source === "gitee"
      ? this.fetchLatestStableGiteeRelease(signal)
      : this.fetchLatestStableGithubRelease(signal);
  }

  private async fetchLatestStableGiteeRelease(signal?: AbortSignal): Promise<LatestStableRelease> {
    const requestUrl = this.cacheBustedUrl(GITEE_LATEST_RELEASE_URL);
    const rawRelease = await fetchJsonResource(requestUrl, {
      sourceLabel: "Gitee 最新正式版",
      timeoutMs: GITEE_REQUEST_TIMEOUT_MS,
      maxLength: MAX_RELEASE_HISTORY_RESPONSE_LENGTH,
      headers: this.giteeHeaders(),
      signal
    });
    if (this.portable) {
      const identity = parsePortableGiteeReleaseIdentity(rawRelease);
      if (!identity) {
        throw new Error("Gitee latest 不是可用的 Portable 正式版本。");
      }
      const summary = parsePortableGiteeReleaseSummary(rawRelease);
      if (!summary) {
        return parseLatestPortableGiteeRelease(rawRelease, undefined, this.state.currentVersion);
      }
      try {
        const rawManifest = await fetchJsonResource(this.cacheBustedUrl(summary.manifestUrl), {
          sourceLabel: `Gitee v${summary.version} Portable 更新清单`,
          timeoutMs: GITEE_REQUEST_TIMEOUT_MS,
          maxLength: MAX_UPDATE_MANIFEST_RESPONSE_LENGTH,
          headers: this.giteeHeaders(),
          signal
        });
        return parseLatestPortableGiteeRelease(rawRelease, rawManifest, this.state.currentVersion);
      } catch (error) {
        if (comparePortableVersions(identity.version, this.state.currentVersion) <= 0) {
          return parseLatestPortableGiteeRelease(rawRelease, undefined, this.state.currentVersion);
        }
        throw error;
      }
    }

    const summary = parseGiteeReleaseSummary(rawRelease);
    if (!summary) {
      throw new Error("Gitee 最新正式版尚未同步完整的 Windows 更新资产。");
    }
    const rawManifest = await fetchJsonResource(this.cacheBustedUrl(summary.manifestUrl), {
      sourceLabel: `Gitee v${summary.version} 更新清单`,
      timeoutMs: GITEE_REQUEST_TIMEOUT_MS,
      maxLength: MAX_UPDATE_MANIFEST_RESPONSE_LENGTH,
      headers: this.giteeHeaders(),
      signal
    });
    return parseLatestStableGiteeRelease(rawRelease, rawManifest);
  }

  private async fetchLatestStableGithubRelease(signal?: AbortSignal): Promise<LatestStableRelease> {
    const rawRelease = await fetchJsonResource(this.cacheBustedUrl(LATEST_RELEASE_URL), {
      sourceLabel: "GitHub 最新正式版",
      timeoutMs: RELEASE_HISTORY_REQUEST_TIMEOUT_MS,
      maxLength: MAX_RELEASE_HISTORY_RESPONSE_LENGTH,
      headers: this.githubHeaders(),
      signal
    });
    return this.portable
      ? parseLatestPortableGithubRelease(rawRelease, this.state.currentVersion)
      : parseLatestStableGithubRelease(rawRelease);
  }

  private async fetchReleaseDetails(source: UpdateSource, targetVersion: string): Promise<UpdateReleaseDetails> {
    const isGitee = source === "gitee";
    const rawReleases = await fetchJsonResource(this.cacheBustedUrl(isGitee ? GITEE_RELEASE_HISTORY_URL : RELEASE_HISTORY_URL), {
      sourceLabel: `${isGitee ? "Gitee" : "GitHub"} 正式版本列表`,
      timeoutMs: isGitee ? GITEE_REQUEST_TIMEOUT_MS : RELEASE_HISTORY_REQUEST_TIMEOUT_MS,
      maxLength: MAX_RELEASE_HISTORY_RESPONSE_LENGTH,
      headers: isGitee ? this.giteeHeaders() : this.githubHeaders()
    });
    const range = selectStableReleaseRange(rawReleases, targetVersion);
    const compareUrl = comparisonWebUrl(source, range.baseVersion, range.targetVersion);
    const releaseUrl = range.releaseUrl ?? (isGitee
      ? `https://gitee.com/zjx_master/git-ui-pro/releases/tag/v${range.targetVersion}`
      : githubReleaseUrl(range.targetVersion));

    try {
      const rawComparison = await fetchJsonResource(this.cacheBustedUrl(comparisonApiUrl(source, range.baseVersion, range.targetVersion)), {
        sourceLabel: `${isGitee ? "Gitee" : "GitHub"} v${range.baseVersion} 到 v${range.targetVersion} 的版本变更`,
        timeoutMs: isGitee ? GITEE_REQUEST_TIMEOUT_MS : RELEASE_HISTORY_REQUEST_TIMEOUT_MS,
        maxLength: MAX_RELEASE_HISTORY_RESPONSE_LENGTH,
        headers: isGitee ? this.giteeHeaders() : this.githubHeaders()
      });
      const comparison = parseComparisonCommits(rawComparison, source);
      if (comparison.commits.length === 0) {
        throw new Error(`v${range.baseVersion} 到 v${range.targetVersion} 之间没有可显示的提交记录。`);
      }
      return {
        source,
        baseVersion: range.baseVersion,
        targetVersion: range.targetVersion,
        publishedAt: range.publishedAt,
        releaseUrl,
        compareUrl,
        commits: comparison.commits,
        totalCommits: comparison.totalCommits,
        fallbackNotes: [],
        contentSource: "compare"
      };
    } catch (error) {
      const fallbackNotes = cleanReleaseNoteItems(range.releaseNotes);
      if (fallbackNotes.length === 0) {
        throw error;
      }
      return {
        source,
        baseVersion: range.baseVersion,
        targetVersion: range.targetVersion,
        publishedAt: range.publishedAt,
        releaseUrl,
        compareUrl,
        commits: [],
        totalCommits: 0,
        fallbackNotes,
        contentSource: "release"
      };
    }
  }

  private async fetchReleaseHistory(): Promise<UpdateReleaseCatalog> {
    const catalog = this.state.source === "gitee"
      ? await this.fetchGiteeReleaseHistory()
      : await this.fetchGithubReleaseHistory();
    if (catalog.entries.length === 0) {
      throw new Error(`${this.state.source === "gitee" ? "Gitee" : "GitHub"} 暂无可校验的历史版本。`);
    }
    return catalog;
  }

  private async fetchGiteeReleaseHistory(): Promise<UpdateReleaseCatalog> {
    if (this.portable) {
      return this.fetchPortableGiteeReleaseHistory();
    }
    const rawReleases = await fetchJsonResource(this.cacheBustedUrl(GITEE_RELEASE_HISTORY_URL), {
      sourceLabel: "Gitee 历史版本",
      timeoutMs: GITEE_REQUEST_TIMEOUT_MS,
      maxLength: MAX_RELEASE_HISTORY_RESPONSE_LENGTH,
      headers: this.giteeHeaders()
    });
    const candidates = selectGiteeHistoryCandidates(rawReleases, this.state.currentVersion);
    const verified = await Promise.all(candidates.map((candidate) => this.verifyGiteeHistoryCandidate(candidate)));
    return buildGiteeReleaseHistoryCatalog(
      verified.filter((release): release is VerifiedGiteeRelease => release !== null),
      this.state.currentVersion
    );
  }

  private async fetchPortableGiteeReleaseHistory(): Promise<PortableReleaseCatalog> {
    const rawReleases = await fetchJsonResource(this.cacheBustedUrl(GITEE_RELEASE_HISTORY_URL), {
      sourceLabel: "Gitee Portable 历史版本",
      timeoutMs: GITEE_REQUEST_TIMEOUT_MS,
      maxLength: MAX_RELEASE_HISTORY_RESPONSE_LENGTH,
      headers: this.giteeHeaders()
    });
    const candidates = selectPortableGiteeHistoryCandidates(rawReleases, this.state.currentVersion);
    const verified = await Promise.all(candidates.map((candidate) => this.verifyPortableGiteeHistoryCandidate(candidate)));
    return buildPortableGiteeReleaseHistoryCatalog(
      verified.filter((target): target is PortableUpdateTarget => target !== null),
      this.state.currentVersion
    );
  }

  private async verifyPortableGiteeHistoryCandidate(
    candidate: PortableGiteeReleaseSummary
  ): Promise<PortableUpdateTarget | null> {
    try {
      const manifest = await fetchJsonResource(this.cacheBustedUrl(candidate.manifestUrl), {
        sourceLabel: `Gitee v${candidate.version} Portable 更新清单`,
        timeoutMs: GITEE_REQUEST_TIMEOUT_MS,
        maxLength: MAX_UPDATE_MANIFEST_RESPONSE_LENGTH,
        headers: this.giteeHeaders()
      });
      return verifyPortableGiteeRelease(candidate, manifest);
    } catch (error) {
      console.warn(`忽略无法校验的 Gitee Portable 历史版本 v${candidate.version}`, error);
      return null;
    }
  }

  private async verifyGiteeHistoryCandidate(candidate: GiteeReleaseSummary): Promise<VerifiedGiteeRelease | null> {
    try {
      const manifest = await fetchJsonResource(this.cacheBustedUrl(candidate.manifestUrl), {
        sourceLabel: `Gitee v${candidate.version} 更新清单`,
        timeoutMs: GITEE_REQUEST_TIMEOUT_MS,
        maxLength: MAX_UPDATE_MANIFEST_RESPONSE_LENGTH,
        headers: this.giteeHeaders()
      });
      return verifyGiteeRelease(candidate, manifest);
    } catch (error) {
      console.warn(`忽略无法校验的 Gitee 历史版本 v${candidate.version}`, error);
      return null;
    }
  }

  private async fetchGithubReleaseHistory(): Promise<UpdateReleaseCatalog> {
    const rawReleases = await fetchJsonResource(this.cacheBustedUrl(RELEASE_HISTORY_URL), {
      sourceLabel: "GitHub 历史版本",
      timeoutMs: RELEASE_HISTORY_REQUEST_TIMEOUT_MS,
      maxLength: MAX_RELEASE_HISTORY_RESPONSE_LENGTH,
      headers: this.githubHeaders()
    });
    return this.portable
      ? buildPortableGithubReleaseHistoryCatalog(rawReleases, this.state.currentVersion)
      : buildReleaseHistoryCatalog(rawReleases, this.state.currentVersion);
  }

  private cacheBustedUrl(value: string): string {
    const requestUrl = new URL(value);
    requestUrl.searchParams.set("update-check", `${Date.now()}-${++this.latestReleaseRequestSeed}`);
    return requestUrl.toString();
  }

  private giteeHeaders(): Record<string, string> {
    return {
      Accept: "application/json",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      "User-Agent": `Git-UI-Pro/${this.state.currentVersion}`
    };
  }

  private githubHeaders(): Record<string, string> {
    return {
      ...this.giteeHeaders(),
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
  }

  private stateFromInfo(
    phase: "available" | "downloaded",
    info: UpdateInfo,
    operation: UpdateOperation,
    releaseUrl = githubReleaseUrl(info.version)
  ): UpdateStateInput {
    return {
      phase,
      operation,
      currentVersion: this.state.currentVersion,
      availableVersion: info.version,
      releaseName: info.releaseName?.trim() || `Git UI Pro v${info.version}`,
      releaseNotes: normalizeReleaseNotes(info.releaseNotes),
      releaseDate: info.releaseDate,
      releaseUrl
    };
  }

  private stateFromPortableTarget(
    phase: "available" | "downloaded",
    target: PortableUpdateTarget,
    operation: UpdateOperation
  ): UpdateStateInput {
    return {
      phase,
      operation,
      currentVersion: this.state.currentVersion,
      availableVersion: target.version,
      releaseName: target.releaseName,
      releaseNotes: target.releaseNotes,
      releaseDate: target.releaseDate,
      releaseUrl: target.releaseUrl
    };
  }

  private setError(error: unknown, operation: UpdateOperation): void {
    this.setState({ ...this.state, operation, phase: "error", error: updateErrorMessage(error) });
  }

  private setState(state: UpdateStateInput): void {
    this.state = {
      ...state,
      source: state.source ?? this.state.source,
      capabilities: cloneCapabilities(state.capabilities ?? this.capabilities),
      revision: this.state.revision + 1
    };
    this.emit();
  }

  private emit(): void {
    this.onStateChange(this.getState());
  }
}

function normalizeProgress(progress: UpdateProgressInput, source?: InstallerDownloadSource): UpdateProgress {
  return {
    percent: Math.max(0, Math.min(100, progress.percent)),
    transferred: Math.max(0, progress.transferred),
    total: Math.max(0, progress.total),
    bytesPerSecond: Math.max(0, progress.bytesPerSecond),
    sourceId: source?.id,
    sourceLabel: source?.label,
    sourceReleaseUrl: source?.target.releaseUrl
  };
}

export function macUpdateProgress(progress: UpdateProgressInput, releaseUrl?: string): UpdateProgress {
  return {
    ...normalizeProgress(progress),
    sourceId: "github",
    sourceLabel: "GitHub 更新源",
    sourceReleaseUrl: releaseUrl
  };
}

function emptyInstallerProgress(source: InstallerDownloadSource): UpdateProgress {
  return {
    percent: 0,
    transferred: 0,
    total: 0,
    bytesPerSecond: 0,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceReleaseUrl: source.target.releaseUrl,
    resumed: false
  };
}

function cloneState(state: UpdateState): UpdateState {
  return {
    ...state,
    capabilities: cloneCapabilities(state.capabilities),
    progress: state.progress ? { ...state.progress } : undefined
  };
}

function cloneCapabilities(capabilities: UpdateCapabilities): UpdateCapabilities {
  return { sources: [...capabilities.sources], rollback: capabilities.rollback };
}

function cloneReleaseDetails(details: UpdateReleaseDetails): UpdateReleaseDetails {
  return {
    ...details,
    commits: details.commits.map((commit) => ({ ...commit })),
    fallbackNotes: [...details.fallbackNotes]
  };
}

function normalizeStableVersion(value: string): string | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.trim());
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

function requirePortableTarget(value: RollbackTarget | PortableUpdateTarget | null): PortableUpdateTarget {
  if (
    value !== null &&
    "artifactName" in value &&
    typeof value.artifactName === "string" &&
    typeof value.size === "number" &&
    Number.isSafeInteger(value.size) &&
    value.size > 0
  ) {
    return value;
  }
  throw new Error("当前发行版缺少 Windows Portable 更新资产。");
}

function requireRollbackTarget(value: RollbackTarget | PortableUpdateTarget | null): RollbackTarget {
  if (value && !("artifactName" in value)) {
    return value;
  }
  throw new Error("当前发行版缺少 Windows 安装版更新资产。");
}

function installerDownloadSources(target: RollbackTarget, preferredSource: UpdateSource): readonly InstallerDownloadSource[] {
  const version = normalizeStableVersion(target.version);
  if (!version) {
    throw new Error("Windows 安装版更新目标版本无效。");
  }
  const tagName = `v${version}`;
  const artifactName = `Git-UI-Pro-Setup-${version}-x64.exe`;
  const shared = {
    version,
    releaseName: target.releaseName,
    releaseNotes: target.releaseNotes,
    releaseDate: target.releaseDate,
    sha256: target.sha256
  };
  const sources: readonly InstallerDownloadSource[] = Object.freeze([
    Object.freeze({
      id: "github" as const,
      label: "GitHub 更新源",
      target: Object.freeze({
        ...shared,
        releaseUrl: `https://github.com/zjx150504-lgtm/Git_UI_Pro/releases/tag/${tagName}`,
        downloadUrl: `https://github.com/zjx150504-lgtm/Git_UI_Pro/releases/download/${tagName}/${artifactName}`
      })
    }),
    Object.freeze({
      id: "gitee" as const,
      label: "Gitee 国内源",
      target: Object.freeze({
        ...shared,
        releaseUrl: `https://gitee.com/zjx_master/git-ui-pro/releases/tag/${tagName}`,
        downloadUrl: `https://gitee.com/zjx_master/git-ui-pro/releases/download/${tagName}/${artifactName}`
      })
    })
  ]);
  return preferredSource === "gitee" ? Object.freeze([sources[1], sources[0]]) : sources;
}
function requireUpdateSource(source: unknown): UpdateSource {
  if (source === "github" || source === "gitee") {
    return source;
  }
  throw new Error("更新源必须是 GitHub 或 Gitee。");
}

type JsonResourceOptions = {
  sourceLabel: string;
  timeoutMs: number;
  maxLength: number;
  headers: Record<string, string>;
  signal?: AbortSignal;
};

async function fetchJsonResource(url: string, options: JsonResourceOptions): Promise<unknown> {
  const controller = new AbortController();
  let timedOut = false;
  const abortRequest = () => controller.abort();
  options.signal?.addEventListener("abort", abortRequest, { once: true });
  if (options.signal?.aborted) {
    controller.abort();
  }
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  let response: Response;
  try {
    response = await net.fetch(url, {
      headers: options.headers,
      signal: controller.signal
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(`读取${options.sourceLabel}超时，请检查网络后重试。`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortRequest);
  }

  if (!response.ok) {
    if (response.status === 403 || response.status === 429) {
      throw new Error(`${options.sourceLabel}查询受限，请稍后重试。`);
    }
    throw new Error(`无法读取${options.sourceLabel}（HTTP ${response.status}）。`);
  }

  const rawText = await response.text();
  if (rawText.length > options.maxLength) {
    throw new Error(`${options.sourceLabel}返回的数据异常，已停止处理。`);
  }
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`${options.sourceLabel}返回的数据无法解析。`);
  }
}
