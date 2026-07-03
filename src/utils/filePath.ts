export function absoluteFilePath(repositoryPath: string | undefined, filePath: string): string {
  if (!repositoryPath) {
    return filePath;
  }

  const separator = repositoryPath.includes("\\") ? "\\" : "/";
  const root = repositoryPath.replace(/[\\/]+$/, "");
  const relativePath = filePath.replace(/^[\\/]+/, "").replace(/[\\/]+/g, separator);
  return `${root}${separator}${relativePath}`;
}
