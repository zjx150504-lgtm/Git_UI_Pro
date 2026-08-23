import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import { mergeMacUpdateMetadata, mergeMacUpdateMetadataFiles } from "./merge-mac-update-metadata.mjs";

const SHA512 = Buffer.alloc(64, 1).toString("base64");

function metadata(architecture, overrides = {}) {
  const version = overrides.version ?? "0.2.0";
  return {
    version,
    files: overrides.files ?? [
      { url: `Git-UI-Pro-${version}-mac-${architecture}.zip`, sha512: SHA512, size: 100 },
      { url: `Git-UI-Pro-${version}-mac-${architecture}.dmg`, sha512: SHA512, size: 120 }
    ],
    path: `Git-UI-Pro-${version}-mac-${architecture}.zip`,
    sha512: SHA512,
    releaseDate: overrides.releaseDate ?? "2026-08-23T12:00:00.000Z"
  };
}

async function writeArtifactSet(root, architecture) {
  const directory = path.join(root, architecture);
  await mkdir(directory, { recursive: true });
  const files = ["zip", "dmg"].map((extension) => {
    const content = Buffer.from(`${architecture}-${extension}-content`);
    return {
      content,
      metadata: {
        url: `Git-UI-Pro-0.2.0-mac-${architecture}.${extension}`,
        sha512: createHash("sha512").update(content).digest("base64"),
        size: content.length
      }
    };
  });
  await Promise.all(files.map((file) => writeFile(path.join(directory, file.metadata.url), file.content)));
  const document = metadata(architecture, { files: files.map((file) => file.metadata) });
  const metadataPath = path.join(directory, "latest-mac.yml");
  await writeFile(metadataPath, yaml.dump(document), "utf8");
  return { directory, files, metadataPath };
}

test("合并 x64 与 arm64 macOS 更新元数据", () => {
  const merged = mergeMacUpdateMetadata([
    metadata("x64"),
    metadata("arm64", { releaseDate: "2026-08-23T12:01:00.000Z" })
  ]);

  assert.equal(merged.version, "0.2.0");
  assert.deepEqual(merged.files.map((file) => file.url), [
    "Git-UI-Pro-0.2.0-mac-x64.zip",
    "Git-UI-Pro-0.2.0-mac-x64.dmg",
    "Git-UI-Pro-0.2.0-mac-arm64.zip",
    "Git-UI-Pro-0.2.0-mac-arm64.dmg"
  ]);
  assert.equal(merged.path, "Git-UI-Pro-0.2.0-mac-x64.zip");
  assert.equal(merged.releaseDate, "2026-08-23T12:01:00.000Z");
});

test("拒绝版本不一致、架构重复或缺少 ZIP 的元数据", () => {
  assert.throws(
    () => mergeMacUpdateMetadata([metadata("x64"), metadata("arm64", { version: "0.2.1" })]),
    /版本不一致/
  );
  assert.throws(
    () => mergeMacUpdateMetadata([metadata("x64"), metadata("x64")]),
    /缺少 macOS arm64/
  );
  assert.throws(
    () => mergeMacUpdateMetadata([
      metadata("x64"),
      metadata("arm64", {
        files: [
          { url: "Git-UI-Pro-0.2.0-mac-arm64.dmg", sha512: SHA512, size: 120 },
          { url: "Git-UI-Pro-0.2.0-mac-arm64.dmg", sha512: SHA512, size: 120 }
        ]
      })
    ]),
    /同时包含 DMG 和 ZIP/
  );
});

test("合并前校验 macOS 文件的实际大小与 SHA-512", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "git-ui-pro-mac-metadata-"));
  try {
    const x64 = await writeArtifactSet(directory, "x64");
    const arm64 = await writeArtifactSet(directory, "arm64");
    const outputPath = path.join(directory, "latest-mac.yml");

    await mergeMacUpdateMetadataFiles(x64.metadataPath, arm64.metadataPath, outputPath);
    const merged = yaml.load(await readFile(outputPath, "utf8"));
    assert.equal(merged.files.length, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("拒绝内容被同长度篡改的 macOS 更新文件", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "git-ui-pro-mac-tamper-"));
  try {
    const x64 = await writeArtifactSet(directory, "x64");
    const arm64 = await writeArtifactSet(directory, "arm64");
    const zip = x64.files[0];
    await writeFile(path.join(x64.directory, zip.metadata.url), Buffer.alloc(zip.content.length, 0x78));

    await assert.rejects(
      mergeMacUpdateMetadataFiles(x64.metadataPath, arm64.metadataPath, path.join(directory, "latest-mac.yml")),
      /SHA-512 校验失败/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("拒绝实际大小与元数据不一致的 macOS 更新文件", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "git-ui-pro-mac-size-"));
  try {
    const x64 = await writeArtifactSet(directory, "x64");
    const arm64 = await writeArtifactSet(directory, "arm64");
    const dmg = arm64.files[1];
    await writeFile(path.join(arm64.directory, dmg.metadata.url), Buffer.concat([dmg.content, Buffer.from("tampered")]));

    await assert.rejects(
      mergeMacUpdateMetadataFiles(x64.metadataPath, arm64.metadataPath, path.join(directory, "latest-mac.yml")),
      /大小不一致/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("元数据文件不存在时报告架构和文件路径", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "git-ui-pro-mac-missing-metadata-"));
  try {
    const arm64 = await writeArtifactSet(directory, "arm64");
    const missingPath = path.join(directory, "x64", "latest-mac.yml");

    await assert.rejects(
      mergeMacUpdateMetadataFiles(missingPath, arm64.metadataPath, path.join(directory, "latest-mac.yml")),
      (error) => {
        assert.match(error.message, /macOS x64 更新元数据文件不存在/);
        assert.match(error.message, /x64[/\\]latest-mac\.yml/);
        return true;
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("元数据 YAML 损坏时报告架构和解析错误", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "git-ui-pro-mac-invalid-metadata-"));
  try {
    const x64 = await writeArtifactSet(directory, "x64");
    const arm64 = await writeArtifactSet(directory, "arm64");
    await writeFile(arm64.metadataPath, "version: [unterminated", "utf8");

    await assert.rejects(
      mergeMacUpdateMetadataFiles(x64.metadataPath, arm64.metadataPath, path.join(directory, "latest-mac.yml")),
      /macOS arm64 更新元数据 YAML 无法解析/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
