金融学人1.2：用日常语言做选择
本地1.2交付；1.1和1.0原目录、存档、发布包不变。

打开index.html即可使用，无须服务器。
先选“多学一点 / 少累一点 / 增加收入”，填写现状和底线，比较代价，选一项试一周。
结果直接呈现最后剩多少钱、这段时间平均有多累、学习效果等。
“更多工具”包含比较两种安排、多花一小时值不值、我的当前状态、这些估计稳不稳。
术语、单位、公式、假设和表述对照保留在“底层模型”。

睡眠不知道怎么填：在第2步展开“睡眠和精力不知道怎么填？”。
先有一个参考，再每天记实际睡了多久、睡前有多累、睡得怎样。
记录不足就保留原设置；记录够了才提供待确认的参考。
每周核对实际工作、学习等时间后，才尝试更新起点或恢复设置。
保存记录不改模型；点击采用后，个人方案和结果自动更新。
每日、每周草稿和记录在本机保存，包含在“导出全部数据”里。

已有数据：在1.1导出全部数据，再到1.2的“保存与导出”导入。
两个版本使用独立工作区键，不自动搬移或覆盖旧存档。
1.2保留1.1的睡眠和资金方程，不因文字变化改变同输入下的数值。

文件索引
MODEL_SPEC.txt：完整模型；SLEEP_MODEL.txt：1.1引入的睡眠方程。
SLEEP_DIARY.txt：记录、筛选、试算、确认规则及单位。
LANGUAGE_RESEARCH.txt：整站表述依据和词语对照。
model-definition.json：可机器读取的模型与界面定义。
HANDOFF.txt：开发交接；VALIDATION.txt：测试范围与验收状态。
browser-check.html：Edge中运行120项检查，导出JSON报告。

构建与验证
node scripts/build-offline.mjs
node scripts/export-definition.mjs
node --test --test-reporter=tap test/*.test.mjs
python3 scripts/check-structure.py
node scripts/build-browser-check.mjs

本地176项自动回归、218个静态ID检查、Edge120项回归通过。
当前报告qa/browser-report.json与运行文件和检查器源码SHA256一致。
用户提供的展开截图可见部分无明显遮挡；不是所有页面的逐像素审美验收。
日常使用请打开index.html；browser-check.html内的43天记录是隔离测试数据。
发布包financial-human-model-1.2-guided.zip含源码、测试、完整说明与验收记录。
仅本地交付，未推送GitHub或公开部署；工程验收不代表模型已被实证验证。
package-release.py校验当前三个运行文件及两份检查器源码与通过报告一致后打包。
