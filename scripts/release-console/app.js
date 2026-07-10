const token = document.querySelector('meta[name="release-token"]').content;

const elements = {
  addNoteButton: document.querySelector("#addNoteButton"),
  artifactBox: document.querySelector("#artifactBox"),
  artifactList: document.querySelector("#artifactList"),
  automaticNoteList: document.querySelector("#automaticNoteList"),
  blockerBox: document.querySelector("#blockerBox"),
  blockerList: document.querySelector("#blockerList"),
  branchBadge: document.querySelector("#branchBadge span"),
  changeCount: document.querySelector("#changeCount"),
  changeList: document.querySelector("#changeList"),
  commitTitle: document.querySelector("#commitTitle"),
  confirmCheckbox: document.querySelector("#confirmCheckbox"),
  copyLogsButton: document.querySelector("#copyLogsButton"),
  customNoteInput: document.querySelector("#customNoteInput"),
  customNoteList: document.querySelector("#customNoteList"),
  currentVersion: document.querySelector("#currentVersion"),
  dialogBranch: document.querySelector("#dialogBranch"),
  dialogBuild: document.querySelector("#dialogBuild"),
  dialogPublishButton: document.querySelector("#dialogPublishButton"),
  dialogVersion: document.querySelector("#dialogVersion"),
  giteeRemote: document.querySelector("#giteeRemote"),
  giteeState: document.querySelector("#giteeState"),
  githubRemote: document.querySelector("#githubRemote"),
  githubState: document.querySelector("#githubState"),
  historyCount: document.querySelector("#historyCount"),
  historyList: document.querySelector("#historyList"),
  jobState: document.querySelector("#jobState"),
  latestTag: document.querySelector("#latestTag"),
  logOutput: document.querySelector("#logOutput"),
  noteCount: document.querySelector("#noteCount"),
  noteLimit: document.querySelector("#noteLimit"),
  publishButton: document.querySelector("#publishButton"),
  publishHint: document.querySelector("#publishHint"),
  readinessBadge: document.querySelector("#readinessBadge"),
  refreshButton: document.querySelector("#refreshButton"),
  releaseDialog: document.querySelector("#releaseDialog"),
  removeNoteIcon: document.querySelector("#removeNoteIcon"),
  retryButton: document.querySelector("#retryButton"),
  stageList: document.querySelector("#stageList"),
  toast: document.querySelector("#toast"),
  versionInput: document.querySelector("#versionInput"),
  versionValidation: document.querySelector("#versionValidation")
};

let repositoryStatus = null;
let activeJob = null;
let pollingTimer = null;
let toastTimer = null;
let automaticNotes = [];
let customNotes = [];

const glassWorkspace = document.querySelector(".release-workspace");
glassWorkspace.addEventListener("pointermove", (event) => {
  const bounds = glassWorkspace.getBoundingClientRect();
  glassWorkspace.style.setProperty("--glass-x", `${((event.clientX - bounds.left) / bounds.width) * 100}%`);
  glassWorkspace.style.setProperty("--glass-y", `${((event.clientY - bounds.top) / bounds.height) * 100}%`);
});
glassWorkspace.addEventListener("pointerleave", () => {
  glassWorkspace.style.setProperty("--glass-x", "32%");
  glassWorkspace.style.setProperty("--glass-y", "18%");
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-release-token": token,
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `请求失败（${response.status}）`);
  }
  return payload;
}

function setText(element, value) {
  element.textContent = value;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  setText(elements.toast, message);
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 4200);
}

function versionParts(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.trim());
  return match ? match.slice(1).map(Number) : null;
}

function compareVersion(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) {
    return null;
  }
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function getNotes() {
  return [...automaticNotes, ...customNotes];
}

function getBuildMode() {
  return document.querySelector('input[name="buildMode"]:checked').value;
}

function normalizeNote(note) {
  return String(note).trim().replace(/^\d+[.、]\s*/, "");
}

function renderNotes() {
  elements.automaticNoteList.replaceChildren();
  automaticNotes.forEach((note, index) => {
    const item = document.createElement("li");
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const text = document.createElement("span");
    text.textContent = note;
    item.append(number, text);
    elements.automaticNoteList.append(item);
  });

  elements.customNoteList.replaceChildren();
  customNotes.forEach((note, index) => {
    const item = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = note;
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.title = "删除这条补充说明";
    removeButton.setAttribute("aria-label", `删除补充说明：${note}`);
    removeButton.append(elements.removeNoteIcon.content.cloneNode(true));
    removeButton.addEventListener("click", () => {
      customNotes.splice(index, 1);
      renderNotes();
    });
    item.append(text, removeButton);
    elements.customNoteList.append(item);
  });

  const count = getNotes().length;
  const remaining = Math.max(0, 12 - count);
  setText(elements.noteCount, `${count} 条说明`);
  setText(elements.noteLimit, remaining ? `还可补充 ${remaining} 条` : "已达到 12 条上限");
  elements.customNoteInput.disabled = remaining === 0;
  elements.addNoteButton.disabled = remaining === 0 || !normalizeNote(elements.customNoteInput.value);
  updatePublishAvailability();
}

function addCustomNote() {
  const note = normalizeNote(elements.customNoteInput.value);
  if (!note) {
    return;
  }
  if (getNotes().length >= 12) {
    showToast("版本说明最多 12 条");
    return;
  }
  if (note.length > 200) {
    showToast("每条补充说明不能超过 200 个字符");
    return;
  }
  if (getNotes().includes(note)) {
    showToast("这条说明已经存在");
    return;
  }

  customNotes.push(note);
  elements.customNoteInput.value = "";
  renderNotes();
  elements.customNoteInput.focus();
}

function validateVersion() {
  const value = elements.versionInput.value.trim();
  const validFormat = Boolean(versionParts(value));
  const comparison = validFormat && repositoryStatus ? compareVersion(value, repositoryStatus.baselineVersion) : null;
  const valid = validFormat && comparison > 0;
  elements.versionInput.classList.toggle("invalid", Boolean(value) && !valid);

  if (!value || valid) {
    setText(elements.versionValidation, valid ? `高于版本基线 ${repositoryStatus.baselineVersion}` : "使用 x.y.z 格式");
  } else if (!validFormat) {
    setText(elements.versionValidation, "请输入 x.y.z 格式的稳定版本号");
  } else {
    setText(elements.versionValidation, `必须高于版本基线 ${repositoryStatus.baselineVersion}`);
  }

  setText(elements.commitTitle, `chore(release): 发布 v${value || "--"}`);
  updatePublishAvailability();
  return valid;
}

function updatePublishAvailability() {
  const versionValid = repositoryStatus ? compareVersion(elements.versionInput.value.trim(), repositoryStatus.baselineVersion) > 0 : false;
  const notes = getNotes();
  const ready = Boolean(
    repositoryStatus?.ready &&
    versionValid &&
    notes.length > 0 &&
    notes.length <= 12 &&
    elements.confirmCheckbox.checked &&
    !activeJob
  );
  elements.publishButton.disabled = !ready;

  let hint = "可开始发布";
  if (activeJob) {
    hint = "发布任务正在执行";
  } else if (!repositoryStatus) {
    hint = "等待仓库检查完成";
  } else if (!repositoryStatus.ready) {
    hint = "请先处理发布阻断项";
  } else if (!versionValid) {
    hint = "请确认目标版本号";
  } else if (!notes.length || notes.length > 12) {
    hint = "请填写 1 到 12 条版本说明";
  } else if (!elements.confirmCheckbox.checked) {
    hint = "勾选发布确认后继续";
  }
  setText(elements.publishHint, hint);
}

function renderRemote(provider, remote) {
  const remoteLabel = elements[`${provider}Remote`];
  const remoteState = elements[`${provider}State`];
  if (!remote) {
    setText(remoteLabel, "未配置");
    setText(remoteState, "缺失");
    remoteState.className = "remote-state blocked";
    return;
  }

  setText(remoteLabel, `${remote.name} · ${remote.url}`);
  setText(remoteState, remote.exists ? "已配置" : "发布时添加");
  remoteState.className = `remote-state ${remote.exists ? "ready" : "pending"}`;
}

function fileStateLabel(file) {
  if (file.untracked) return "未跟踪";
  if (file.staged) return "已暂存";
  return "未暂存";
}

function renderChanges(files) {
  elements.changeList.replaceChildren();
  setText(elements.changeCount, `${files.length} 个文件`);
  if (!files.length) {
    const item = document.createElement("li");
    item.className = "empty-row";
    item.textContent = "当前工作区无改动，发布时将提交版本文件";
    elements.changeList.append(item);
    return;
  }

  for (const file of files) {
    const item = document.createElement("li");
    const code = document.createElement("span");
    code.className = "file-code";
    code.textContent = file.code.trim() || "M";
    const path = document.createElement("span");
    path.textContent = file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
    path.title = path.textContent;
    const state = document.createElement("span");
    state.className = "file-state";
    state.textContent = fileStateLabel(file);
    item.append(code, path, state);
    elements.changeList.append(item);
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function renderHistory(history) {
  elements.historyList.replaceChildren();
  setText(elements.historyCount, `${history.length} 个版本`);
  if (!history.length) {
    const item = document.createElement("li");
    item.className = "empty-row";
    item.textContent = "还没有 v* 格式的版本标签";
    elements.historyList.append(item);
    return;
  }

  for (const entry of history) {
    const item = document.createElement("li");
    const version = document.createElement("span");
    version.className = "history-version";
    version.textContent = entry.tag;
    const subject = document.createElement("span");
    subject.className = "history-subject";
    subject.textContent = entry.subject || "无标签说明";
    subject.title = subject.textContent;
    const meta = document.createElement("span");
    meta.className = "history-meta";
    const date = document.createElement("span");
    date.textContent = formatDate(entry.date);
    const hash = document.createElement("span");
    hash.textContent = entry.hash;
    meta.append(date, hash);
    item.append(version, subject, meta);
    elements.historyList.append(item);
  }
}

function setReadiness(status) {
  elements.readinessBadge.className = `status-badge ${status.ready ? "ready" : "blocked"}`;
  elements.readinessBadge.textContent = status.ready ? "仓库就绪" : `${status.blockers.length} 项阻断`;
  elements.blockerBox.hidden = status.ready;
  elements.blockerList.replaceChildren();
  for (const blocker of status.blockers) {
    const item = document.createElement("li");
    item.textContent = blocker;
    elements.blockerList.append(item);
  }
}

function renderStatus(status, preserveForm = false) {
  repositoryStatus = status;
  setText(elements.currentVersion, status.packageVersion);
  setText(elements.latestTag, `最新标签 ${status.latestTag || "暂无"}`);
  setText(elements.branchBadge, `${status.branch || "detached"} · ${status.head}`);
  setReadiness(status);
  renderRemote("gitee", status.remotes.gitee);
  renderRemote("github", status.remotes.github);
  renderChanges(status.files);
  renderHistory(status.history);

  document.querySelectorAll("[data-version-kind]").forEach((button) => {
    const version = status.recommendations?.[button.dataset.versionKind] || "--";
    button.querySelector("strong").textContent = version;
    button.dataset.version = version;
    button.disabled = version === "--";
  });

  if (!preserveForm) {
    elements.versionInput.value = status.recommendations?.patch || "";
    customNotes = [];
  }
  automaticNotes = status.suggestedNotes.map(normalizeNote).filter(Boolean).slice(0, 12);
  validateVersion();
  renderNotes();
}

async function refreshStatus(options = {}) {
  elements.refreshButton.classList.add("loading");
  try {
    renderStatus(await api("/api/status"), options.preserveForm);
  } catch (error) {
    showToast(error.message);
    elements.readinessBadge.className = "status-badge blocked";
    elements.readinessBadge.textContent = "检查失败";
  } finally {
    elements.refreshButton.classList.remove("loading");
    updatePublishAvailability();
  }
}

function stageStatusText(status) {
  return {
    pending: "等待",
    running: "进行中",
    completed: "完成",
    failed: "失败"
  }[status] || status;
}

function renderJob(job) {
  elements.retryButton.dataset.jobId = job.id;
  activeJob = job.state === "queued" || job.state === "running" ? job : null;
  elements.jobState.className = `job-state ${job.state}`;
  setText(elements.jobState, {
    queued: "排队中",
    running: "执行中",
    completed: "已完成",
    failed: "失败"
  }[job.state] || job.state);

  for (const stage of job.stages) {
    const item = elements.stageList.querySelector(`[data-stage="${stage.key}"]`);
    if (!item) continue;
    item.className = stage.status;
    item.querySelector("small").textContent = stageStatusText(stage.status);
  }

  elements.logOutput.replaceChildren();
  if (!job.logs.length) {
    const placeholder = document.createElement("span");
    placeholder.className = "log-placeholder";
    placeholder.textContent = "正在启动发布任务...";
    elements.logOutput.append(placeholder);
  } else {
    for (const entry of job.logs) {
      const line = document.createElement("span");
      line.className = `log-line ${entry.level}`;
      line.textContent = `[${new Date(entry.time).toLocaleTimeString("zh-CN", { hour12: false })}] ${entry.message}`;
      elements.logOutput.append(line);
    }
    elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
  }

  elements.artifactBox.hidden = !job.artifacts.length;
  elements.artifactList.replaceChildren();
  for (const artifact of job.artifacts) {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = artifact.name;
    name.title = artifact.name;
    const size = document.createElement("span");
    size.textContent = formatFileSize(artifact.size);
    item.append(name, size);
    elements.artifactList.append(item);
  }
  elements.retryButton.hidden = !job.canRetryPush || job.state !== "failed";
  updatePublishAvailability();
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function pollJob(jobId) {
  window.clearTimeout(pollingTimer);
  try {
    const job = await api(`/api/jobs/${jobId}`);
    renderJob(job);
    if (job.state === "queued" || job.state === "running") {
      pollingTimer = window.setTimeout(() => pollJob(jobId), 700);
      return;
    }

    activeJob = null;
    if (job.state === "completed") {
      showToast(`${job.tag} 发布完成`);
      elements.confirmCheckbox.checked = false;
      await refreshStatus();
    } else {
      showToast(job.error || "发布失败，请查看实时日志");
      await refreshStatus({ preserveForm: true });
    }
  } catch (error) {
    activeJob = null;
    showToast(error.message);
  } finally {
    updatePublishAvailability();
  }
}

async function startRelease() {
  const payload = {
    version: elements.versionInput.value.trim(),
    notes: getNotes(),
    buildMode: getBuildMode(),
    expectedCurrentVersion: repositoryStatus.packageVersion
  };
  try {
    const job = await api("/api/releases", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    activeJob = job;
    renderJob(job);
    pollJob(job.id);
  } catch (error) {
    activeJob = null;
    showToast(error.message);
    updatePublishAvailability();
  }
}

elements.refreshButton.addEventListener("click", () => refreshStatus({ preserveForm: true }));
elements.versionInput.addEventListener("input", validateVersion);
elements.customNoteInput.addEventListener("input", () => {
  elements.addNoteButton.disabled = getNotes().length >= 12 || !normalizeNote(elements.customNoteInput.value);
});
elements.customNoteInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addCustomNote();
  }
});
elements.addNoteButton.addEventListener("click", addCustomNote);
elements.confirmCheckbox.addEventListener("change", updatePublishAvailability);

document.querySelectorAll("[data-version-kind]").forEach((button) => {
  button.addEventListener("click", () => {
    elements.versionInput.value = button.dataset.version;
    validateVersion();
  });
});

elements.publishButton.addEventListener("click", () => {
  if (!validateVersion()) return;
  setText(elements.dialogVersion, `v${elements.versionInput.value.trim()}`);
  setText(elements.dialogBranch, repositoryStatus.branch);
  setText(elements.dialogBuild, getBuildMode() === "signed" ? "Windows 签名包" : "Windows 常规包");
  elements.releaseDialog.showModal();
});

elements.dialogPublishButton.addEventListener("click", (event) => {
  event.preventDefault();
  elements.releaseDialog.close();
  startRelease();
});

elements.copyLogsButton.addEventListener("click", async () => {
  const text = elements.logOutput.innerText.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast("日志已复制");
  } catch {
    showToast("复制失败，请手动选择日志文本");
  }
});

elements.retryButton.addEventListener("click", async () => {
  if (!activeJob && elements.retryButton.dataset.jobId) {
    try {
      const job = await api(`/api/jobs/${elements.retryButton.dataset.jobId}/retry`, {
        method: "POST",
        body: "{}"
      });
      activeJob = job;
      renderJob(job);
      pollJob(job.id);
    } catch (error) {
      showToast(error.message);
    }
  }
});

refreshStatus();
