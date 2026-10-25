# 第三方组件与英雄素材

v0.3 使用以下开源组件。npm锁文件记录确切版本；构建阶段从已安装依赖复制到`public/ocr`，Vite将它们随应用打包。运行时不会访问OCR CDN。

- [Tesseract.js](https://github.com/naptha/tesseract.js)，Apache-2.0；许可随包位于`ocr/TESSERACT-LICENSE`。
- [Tesseract.js-core](https://github.com/naptha/tesseract.js-core)，Apache-2.0；许可随包位于`ocr/CORE-LICENSE`。
- [`@tesseract.js-data/eng`与`@tesseract.js-data/chi_sim`](https://github.com/naptha/tessdata)，使用`4.0.0_best_int`训练数据。npm包元数据声明MIT，上游训练数据仓库提供Apache-2.0许可证；随包保留包元数据、README和Apache许可证。

这些组件只负责文字识别。游戏头像比较、事件去重、屏蔽、语音调度由本项目代码完成，不代表OCR模型针对英雄联盟训练过。

## Riot Games 英雄素材

`public/champions/` 包含 Riot Data Dragon 16.21.1 的中文英雄资料、173 张头像和173张基础立绘；`manifest.json` 保留来源及稳定英雄 ID。立绘接口本身不带版本号，文件是下载时的快照。可使用 `npm run assets:champions -- 16.21.1` 重新获取，更新后需重新验证识别。

- 官方资料与图像接口：[Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon)。
- 英雄联盟及其英雄图像、名称等素材属于 Riot Games；这些第三方素材不适用本仓库源代码的 MIT 许可。
- 本项目为非官方社区工具，与 Riot Games、腾讯、OP.GG、B站无隶属或认可关系。未使用 OP.GG 抓取器或账号接口。

LOL Watchmate isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.