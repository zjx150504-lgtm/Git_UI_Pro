# Git Graph 回归样例

`src/data/graphRegressionScenarios.ts` 保存固定图表样例，目的是把最近反复调整的 Git 图线、引用标签和展开文件行为沉淀成可复现输入。

## 覆盖范围

1. `linear-current-remote-tag`
   - 线性历史
   - HEAD、本地分支、远程分支和标签同线显示
   - 展开文件时主线不偏移

2. `merge-with-expanded-files`
   - 二父合并
   - 合并弧线连接节点右侧中点
   - 展开文件后支线不断开，文件列表不遮挡分支线

3. `diverged-local-remote`
   - 本地分支和远程分支分歧
   - 本地蓝色、远程紫色
   - 共同祖先处线条自然收束

4. `octopus-merge-and-long-files`
   - 三父合并
   - 多条支线并行
   - 长文件列表展开后的缩进和滚动

## 使用方式

当前项目还没有测试框架，这些样例先作为稳定输入源。后续可接入：

1. 图表布局纯函数测试：用每个 scenario 的 `commits` 和 `historyRefs` 检查主线、支线、合并弧线坐标。
2. Story/开发预览：在本地开发模式中加一个仅开发可见的 scenario 切换器。
3. Playwright 视觉回归：截图比对展开前后、窄宽面板、浅色/深色主题。

新增或修复图表渲染问题时，优先把复现结构补到这里，再改渲染逻辑。
