# 本次交接核验记录

日期：2026-10-23。应用仍为 v0.4.0；本次修改交接文档和开发测试脚本，没有修改应用识别/问答逻辑，也没有重打安装包或覆盖用户安装。

## 本次实际完成

- 核对当前源码目录、package.json、配置示例、存储实现、已有验证文档和测试入口。
- 确认 Git main 尚无提交、未配置 remote；没有替用户建立提交或推送。
- 建立 `AGENTS.md`、`docs/HANDOFF.md`、`docs/DEEPSEEK_START_HERE.md`，README 加入入口。
- 整理 7 张用户原图和 4 张浏览器观察图至 `artifacts/handoff-fixtures/`，保存原始字节，生成来源、文件大小和 SHA-256 manifest；11张校验通过。
- 新增 `scripts/handoff-fixtures.mjs`，提供原电脑导出与新环境 `--verify` 校验。
- 为核对报告和字形训练脚本补上 `WATCHMATE_FIXTURES` 输入支持；本次未重训或修改 `public/hud-font.json`。
- 用迁移后的图片目录成功生成 `artifacts/recognition-review.html`。报告中的软件识别数值来自既有回归JSON，**不表示本次重新运行图像识别**。
- `node --check` 校验两个调整的脚本通过；TypeScript `tsc --noEmit` 通过；Vitest 6个测试文件、56项测试通过。
- 重新核对 v0.4 安装包 hash，与原交付一致。

本次未重复执行完整图片识别、连续视频、付费API、Windows窗口采集、SAPI实机或安装测试；此前证据及限制见 `VALIDATION-v0.4.md`。交接没有替用户确认真实账户已恢复搜索，也没有新增准确率或延迟承诺。

## 可单独复制的私有样本包

文件：`artifacts/watchmate-v0.4-handoff-fixtures.zip`

大小：19,867,789 字节。

SHA-256：`52C2FE8B3C6DC4E0F29ED5F7326DE57702E5E07BFB94839B44D0B5AD65E07ABE`

包内仅有 `handoff-fixtures/` 的11张原图与manifest；已经直接读取ZIP中的11张图逐一核对hash与大小，全部一致。不包含配置、密钥、用户会话、诊断目录或安装程序。它是维护用私有测试资料，不自动取得赛事图片的公开发布权。

将该压缩包解压到新项目 `artifacts/` 下，应得到 `artifacts/handoff-fixtures/*.png`。之后设置 `WATCHMATE_FIXTURES` 并执行验证。该ZIP**不包含项目源码**，源码仍需按交接清单单独迁移。

## 移交后第一步

把 `DEEPSEEK_START_HERE.md` 中首条提示词交给新维护智能体。让它确认文件齐全、工具能力与实际跑过的检查；保留本记录作为旧环境证据，勿将其当作新环境测试结果。
