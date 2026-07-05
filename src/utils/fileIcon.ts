export interface FileIconInfo {
  label: string;
  className: string;
}

type FileIconTone =
  | "react"
  | "typescript"
  | "javascript"
  | "style"
  | "markup"
  | "config"
  | "markdown"
  | "data"
  | "script"
  | "backend"
  | "mobile"
  | "database"
  | "asset"
  | "lock"
  | "text"
  | "default";

const extensionIcons: Record<string, { label: string; tone: FileIconTone }> = {
  tsx: { label: "TSX", tone: "react" },
  jsx: { label: "JSX", tone: "react" },
  ts: { label: "TS", tone: "typescript" },
  mts: { label: "MTS", tone: "typescript" },
  cts: { label: "CTS", tone: "typescript" },
  js: { label: "JS", tone: "javascript" },
  mjs: { label: "MJS", tone: "javascript" },
  cjs: { label: "CJS", tone: "javascript" },
  css: { label: "CSS", tone: "style" },
  scss: { label: "SC", tone: "style" },
  sass: { label: "SAS", tone: "style" },
  less: { label: "LES", tone: "style" },
  html: { label: "HTM", tone: "markup" },
  htm: { label: "HTM", tone: "markup" },
  vue: { label: "VUE", tone: "markup" },
  svelte: { label: "SV", tone: "markup" },
  astro: { label: "AST", tone: "markup" },
  json: { label: "JSN", tone: "data" },
  jsonc: { label: "JSC", tone: "data" },
  json5: { label: "J5", tone: "data" },
  yaml: { label: "YML", tone: "config" },
  yml: { label: "YML", tone: "config" },
  toml: { label: "TOM", tone: "config" },
  ini: { label: "INI", tone: "config" },
  env: { label: "ENV", tone: "config" },
  md: { label: "MD", tone: "markdown" },
  mdx: { label: "MDX", tone: "markdown" },
  txt: { label: "TXT", tone: "text" },
  log: { label: "LOG", tone: "text" },
  lock: { label: "LCK", tone: "lock" },
  py: { label: "PY", tone: "backend" },
  java: { label: "JAV", tone: "backend" },
  kt: { label: "KT", tone: "mobile" },
  kts: { label: "KTS", tone: "mobile" },
  go: { label: "GO", tone: "backend" },
  rs: { label: "RS", tone: "backend" },
  c: { label: "C", tone: "backend" },
  h: { label: "H", tone: "backend" },
  cc: { label: "CC", tone: "backend" },
  cpp: { label: "CPP", tone: "backend" },
  cxx: { label: "CXX", tone: "backend" },
  hpp: { label: "HPP", tone: "backend" },
  cs: { label: "CS", tone: "backend" },
  php: { label: "PHP", tone: "backend" },
  rb: { label: "RB", tone: "backend" },
  swift: { label: "SW", tone: "mobile" },
  dart: { label: "DRT", tone: "mobile" },
  lua: { label: "LUA", tone: "script" },
  sh: { label: "SH", tone: "script" },
  bash: { label: "BSH", tone: "script" },
  zsh: { label: "ZSH", tone: "script" },
  ps1: { label: "PS", tone: "script" },
  bat: { label: "BAT", tone: "script" },
  cmd: { label: "CMD", tone: "script" },
  sql: { label: "SQL", tone: "database" },
  graphql: { label: "GQL", tone: "data" },
  gql: { label: "GQL", tone: "data" },
  xml: { label: "XML", tone: "markup" },
  svg: { label: "SVG", tone: "asset" },
  png: { label: "PNG", tone: "asset" },
  jpg: { label: "JPG", tone: "asset" },
  jpeg: { label: "JPG", tone: "asset" },
  webp: { label: "WEB", tone: "asset" },
  gif: { label: "GIF", tone: "asset" },
  ico: { label: "ICO", tone: "asset" }
};

const filenameIcons: Record<string, { label: string; tone: FileIconTone }> = {
  dockerfile: { label: "DOC", tone: "config" },
  makefile: { label: "MK", tone: "script" },
  license: { label: "LIC", tone: "text" },
  readme: { label: "MD", tone: "markdown" },
  ".gitignore": { label: "GIT", tone: "config" },
  ".gitattributes": { label: "GIT", tone: "config" },
  ".npmrc": { label: "NPM", tone: "config" },
  ".env": { label: "ENV", tone: "config" }
};

const lockFilePattern = /^(package-lock|pnpm-lock|yarn|bun)\.lock$/i;

export function fileIconInfo(filePath: string): FileIconInfo {
  const fileName = filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
  const lowerName = fileName.toLowerCase();

  if (lockFilePattern.test(lowerName)) {
    return toIconInfo("LCK", "lock");
  }

  const filenameIcon = filenameIcons[lowerName] ?? filenameIcons[lowerName.replace(/\..*$/, "")];
  if (filenameIcon) {
    return toIconInfo(filenameIcon.label, filenameIcon.tone);
  }

  const extension = lowerName.includes(".") ? lowerName.split(".").pop() ?? "" : "";
  const extensionIcon = extensionIcons[extension];
  if (extensionIcon) {
    return toIconInfo(extensionIcon.label, extensionIcon.tone);
  }

  if (extension) {
    return toIconInfo(extension.slice(0, 3).toUpperCase(), "default");
  }

  return toIconInfo("FIL", "default");
}

function toIconInfo(label: string, tone: FileIconTone): FileIconInfo {
  return {
    label,
    className: `file-kind-${tone}`
  };
}
