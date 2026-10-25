# 第三方组件与英雄素材

v0.4 使用以下开源组件。npm锁文件记录确切版本；构建阶段从已安装依赖复制到`public/ocr`，Vite将它们随应用打包。运行时不会访问OCR CDN。

- [Tesseract.js](https://github.com/naptha/tesseract.js)，Apache-2.0；许可随包位于`ocr/TESSERACT-LICENSE`。
- [Tesseract.js-core](https://github.com/naptha/tesseract.js-core)，Apache-2.0；许可随包位于`ocr/CORE-LICENSE`。
- [JSFeat](https://github.com/inspirit/jsfeat)，MIT；用于本地多尺度特征匹配，许可证随包位于 `public/licenses/JSFEAT-LICENSE`。不依赖在线模型。
- [`@tesseract.js-data/eng`与`@tesseract.js-data/chi_sim`](https://github.com/naptha/tessdata)，使用`4.0.0_best_int`训练数据。npm包元数据声明MIT，上游训练数据仓库提供Apache-2.0许可证；随包保留包元数据、README和Apache许可证。

这些组件只负责文字识别。游戏头像比较、事件去重、屏蔽、语音调度由本项目代码完成，不代表OCR模型针对英雄联盟训练过。

## Riot Games 英雄素材

`public/champions/` 在仓库中只提交中文英雄资料、`manifest.json` 与下载脚本，**不提交头像和立绘图片**。构建或从源码运行前执行 `npm run assets:champions -- 16.21.1`，从 Riot Data Dragon 下载 173 张头像和 173 张基础立绘；这些图片只在构建机/本机生成并随安装包分发，不会在用户端下载。`manifest.json` 保留来源及稳定英雄 ID。立绘接口本身不带版本号，文件是下载时的快照。更新后需重新验证识别。

`public/champions/variants/` 补充 CommunityDragon 16.21 的部分游戏内头像变体；清单逐项记录原始静态文件 URL 和 SHA-256。素材仍属于 Riot Games。`scripts/champion-variants.mjs` 可按规范英雄 ID 增量更新，运行应用时不下载素材。

`public/hud-font.json` 保存从授权测试画面中提取的微小数字字形，用于固定转播字体的本地匹配。它不保存比赛截图、选手身份或整幅画面答案。提取步骤与人工字符标注位于 `scripts/train-hud-font.mjs`；回归训练/验证边界见验证文档。

- 官方资料与图像接口：[Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon)。
- 英雄联盟及其英雄图像、名称等素材属于 Riot Games；这些第三方素材不适用本仓库源代码的 MIT 许可。
- 本项目为非官方社区工具，与 Riot Games、腾讯、OP.GG、B站无隶属或认可关系。未使用 OP.GG 抓取器或账号接口。

LOL Watchmate isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
