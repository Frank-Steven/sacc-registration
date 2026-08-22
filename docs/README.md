# SACC 报名系统 · 设计文档

报名系统整体设计文档入口，涵盖**后端**（C++ / WebAssembly + SQLite）与**前端**（React + Ant Design）。

## 文档结构

```
docs/
├── README.md                 ← 本入口
├── overview.md               系统总体设计（三层结构、跨层关联、表设计约定）
├── ux.md                     体验设计（按角色）
├── development.md            开发实现方案（里程碑 / 工程结构 / 实现计划 / 验收）
├── dev-guide.md              开发工作流与环境配置（工具链 / CI / 规范）
├── backend/                  后端设计
│   ├── index.md              后端文档导航
│   ├── wasm.md               WebAssembly 技术方案
│   ├── config-layer.md       配置层（活动 / 分组 / 表单 / 字段 / 配置）
│   ├── user-layer.md         用户层（账号 / 角色 / 通知 / 偏好）
│   ├── data-layer.md         数据层（报名 / 明细 + 状态机）
│   ├── principles.md         设计要点
│   ├── indexes.md            索引设计
│   └── flows.md              典型流程
└── frontend/                 前端设计
    ├── index.md              前端文档导航
    ├── architecture.md       架构 / 技术栈 / 权限 / 路由
    ├── page-design.md        页面设计
    ├── interaction-design.md 功能交互设计
    ├── component-design.md   组件设计
    ├── responsive-design.md  多端响应式布局
    └── data-optimization.md  前端数据优化
```

## 阅读路径

- 后端：[overview](overview.md) → [后端导航](backend/index.md) → 各层 / 要点 / 索引 / 流程
- 前端：[overview](overview.md) → [前端导航](frontend/index.md) → 页面 / 交互 / 组件 / 响应式 / 优化
- 实现：[development](development.md) → 里程碑 M0-M7 顺序推进
- 协作：[dev-guide](dev-guide.md) → 环境配置 / 工作流 / CI

## 技术栈

| 端 | 技术 |
|---|---|
| 后端 | C++（编译为 WebAssembly）+ SQLite，运行于服务端 WASM 运行时 |
| 前端 | React 19 + Ant Design 5 + React Router + Zustand + TanStack Query + axios |
