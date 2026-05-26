# AI 小说工作台

一个本地多用户桌面小说创作软件，面向中文网文作者，重点适配 DeepSeek 辅助写作和番茄小说发布准备。

## 当前功能

- 本地账号体系：注册、登录、退出登录
- 多用户隔离：每个账号独立保存自己的作品库
- 作品管理：新建作品、保存作品、导出工程 JSON
- 作品管理：新建、自动保存、删除、导出工程 JSON
- 作品设定：题材、premise、简介、世界观、角色概览、大纲、备注
- 分卷管理：卷名、卷定位、卷目标、卷末钩子
- 章节管理：章节归属分卷、章节摘要、正文、字数统计
- 角色关系图：角色库、关系链录入
- 时间线：按顺序维护剧情事件
- DeepSeek 写作：续写、润色、剧情拆解、人物加深
- 一键生成前三章：自动生成适合番茄连载开局的前三章
- 审查中心：敏感词检测、番茄规范检查、修改建议
- 桌面版：Electron 桌面运行与打包配置
- 图标生成：自动由 `build/icon.svg` 生成 `icon.png` 和 `icon.ico`

## 技术结构

- 前端：React + Vite
- 后端：Express
- 桌面壳：Electron
- 数据存储：本地 `data/db.json`

## Web 开发启动

```bash
npm install
npm run dev
```

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`

## 桌面版开发启动

```bash
npm run desktop:dev
```

## 打包桌面安装包

```bash
npm run dist:desktop
```

如需单独生成图标：

```bash
npm run generate-icons
```

## DeepSeek 配置

在软件里填写：

- `DeepSeek API Key`
- `API Base URL`，默认 `https://api.deepseek.com`
- `模型名称`，默认 `deepseek-chat`

## 关于番茄小说发布

当前版本已经完成番茄小说“发布准备中心”和“规范检查中心”。

真正的一键上传到番茄作者后台，仍然需要番茄官方可用的正式接口文档。如果你后续拿到真实接口，我可以继续补：

- 自动创建书籍
- 自动上传章节
- 自动同步简介和卖点
- 自动发布流程
