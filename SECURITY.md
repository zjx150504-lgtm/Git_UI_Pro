# Security Policy

## Supported Versions

当前项目仍处于早期版本。安全修复会优先覆盖最新发布版本。

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a Vulnerability

如果你发现安全问题，请优先通过 GitHub Security Advisories 私下反馈。若问题不包含敏感信息，也可以提交 GitHub Issue。

反馈时请尽量提供：

1. 受影响版本和操作系统。
2. 复现步骤。
3. 相关 Git 命令输出或错误截图。
4. 问题可能造成的影响。

请不要在公开 Issue 中贴出访问令牌、SSH 私钥、远程仓库凭据、完整敏感路径或其它个人敏感信息。

## Security Scope

Git UI Pro 调用用户本机 `git` 命令并使用本机 Git 配置、SSH key、Git Credential Manager 或 credential helper。项目不会自建 Git 凭据系统。

安全相关改动需要特别关注：

- 用户输入是否被拼接为 shell 字符串。
- Git 文件路径参数是否通过参数数组传递。
- 危险操作是否经过明确确认。
- 错误日志是否泄露凭据或敏感路径。
