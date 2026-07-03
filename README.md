# 日志管理系统 — 技术与使用文档

> Designed & Developed by kumoto · © 2026-07-02

一套面向团队日常工时填报、审核、统计与查询的 Web 系统。支持桌面端与移动端，管理员可进行人员/项目管理、日志查询、考勤合并、历史 Excel 转换等操作。

---

## 目录

- [1. 项目简介](#1-项目简介)
- [2. 技术栈](#2-技术栈)
- [3. 系统架构](#3-系统架构)
- [4. 运行环境](#4-运行环境)
- [5. 安装与启动](#5-安装与启动)
- [6. 默认账号与环境变量](#6-默认账号与环境变量)
- [7. 用户角色与权限](#7-用户角色与权限)
- [8. 页面与路由一览](#8-页面与路由一览)
- [9. 功能清单](#9-功能清单)
- [10. 业务规则](#10-业务规则)
- [11. API 接口](#11-api-接口)
- [12. 数据库说明](#12-数据库说明)
- [13. Excel 文件格式说明](#13-excel-文件格式说明)
- [14. 项目目录结构](#14-项目目录结构)
- [15. 常见问题](#15-常见问题)

---

## 1. 项目简介

本系统用于解决团队日志（日报/工时）的在线填报、项目负责人审核、管理员汇总查询，以及从传统 Excel 日志表迁移数据的需求。核心能力包括：

- 普通用户按日填报工时日志
- 项目负责人审核所辖项目日志
- 管理员管理用户、项目，查询/导出全站日志
- 考勤 Excel 导入并与日志列表合并展示
- 历史日志 Excel 批量导入数据库
- 原始填报 Excel 按月统计转换（独立工具页）

---

## 2. 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | Python 3 + Flask 3 |
| 数据库 | SQLite（文件：`dailay_converter.db`） |
| 会话认证 | Flask Session + Werkzeug 密码哈希 |
| Excel 解析 | pandas、openpyxl、python-calamine |
| 前端 | HTML 模板（Jinja2）、Bootstrap 5、原生 JavaScript |
| 样式 | 自定义 CSS（`style.css` / `mobile.css`） |
| 验证码 | 自研 SVG 验证码（`captcha.py`） |

### Python 依赖

见 `requirements.txt`：

```
pandas>=2.0.0
openpyxl>=3.1.0
python-calamine>=0.2.0
flask>=3.0.0
```

---

## 3. 系统架构

```
浏览器（桌面 / 移动）
        │
        ▼
   Flask Web 服务 (app.py)
        │
   ┌────┴────┬──────────┬────────────┐
   ▼         ▼          ▼            ▼
database  convert   attendance   log_import
  .py      _logs.py   _import.py    .py
   │
   ▼
SQLite (dailay_converter.db)
```

- **页面路由**：`app.py` 渲染 HTML 模板，按角色控制访问
- **API 路由**：前后端通过 REST JSON 接口交互
- **数据层**：`database.py` 统一封装 CRUD 与业务规则
- **Excel 能力**：
  - `convert_logs.py` — 按月从填报 Excel 提取并统计
  - `attendance_import.py` — 解析月度考勤汇总
  - `log_import.py` — 历史日志写入数据库

---

## 4. 运行环境

| 项目 | 要求 |
|------|------|
| 操作系统 | macOS / Linux / Windows |
| Python | 3.10 及以上（推荐 3.11+） |
| 内存 | 建议 ≥ 512 MB |
| 磁盘 | ≥ 100 MB（含数据库与历史记录） |
| 浏览器 | Chrome、Edge、Safari、Firefox 等现代浏览器 |
| 网络 | 本地运行无需外网；前端 CDN 引用 Bootstrap / 字体时需联网 |

默认服务地址：`http://0.0.0.0:5500`（本机访问 `http://127.0.0.1:5500`）

---

## 5. 安装与启动

### 5.1 获取代码

```bash
cd /path/to/dailay-converter
```

### 5.2 创建虚拟环境（推荐）

```bash
python3 -m venv .venv
source .venv/bin/activate        # macOS / Linux
# .venv\Scripts\activate         # Windows
```

### 5.3 安装依赖

```bash
pip install -r requirements.txt
```

### 5.4 启动服务

```bash
python app.py
```

首次启动会自动：

1. 创建 SQLite 数据库及表结构
2. 初始化默认管理员账号 `admin` / `admin`
3. 若存在 `project_mapping.json` 且项目表为空，自动导入项目映射

### 5.5 访问系统

1. 浏览器打开 `http://127.0.0.1:5500`
2. 未登录时跳转登录页 `/login`
3. 登录后按角色自动跳转：
   - **管理员** → `/admin/logs`（日志查询）
   - **普通用户（桌面）** → `/my-logs`（我的日志）
   - **普通用户（移动竖屏）** → `/m/my-logs`

### 5.6 生产部署建议

- 设置环境变量 `FLASK_SECRET_KEY` 为随机强密钥
- 使用 gunicorn / waitress 等 WSGI 服务替代 `app.run(debug=True)`
- 定期备份 `dailay_converter.db`
- 反向代理（Nginx）启用 HTTPS

---

## 6. 默认账号与环境变量

### 默认管理员

| 字段 | 值 |
|------|-----|
| 用户名 | `admin` |
| 密码 | `admin` |
| 角色 | 管理员 |
| 状态 | 已通过 |

> **安全提示**：首次部署后请立即修改默认密码。

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `FLASK_SECRET_KEY` | Flask Session 签名密钥 | 内置开发用密钥 |

---

## 7. 用户角色与权限

| 角色 | 说明 | 可访问页面 |
|------|------|------------|
| **未登录** | 访客 | 登录、注册 |
| **待审核用户** | 已注册未通过审核 | 仅登录页（登录会被拒绝） |
| **普通用户** | 已通过审核 | 我的日志、个人信息 |
| **项目负责人** | 普通用户 + 被指定为某项目负责人 | 额外可访问「日志审核」 |
| **管理员** | 系统管理员 | 日志查询、项目管理、人员管理、Excel 转换 |

权限装饰器（`auth.py`）：

- `login_required` — 需登录
- `approved_user_required` — 需已通过审核（管理员豁免）
- `manager_required` — 需为项目负责人
- `admin_required` — 需管理员

---

## 8. 页面与路由一览

### 8.1 公开页面

| 路径 | 页面 | 说明 |
|------|------|------|
| `/login` | 登录 | 用户名 + 密码 + SVG 验证码 |
| `/register` | 注册 | 注册后需管理员审核 |

### 8.2 普通用户（桌面端）

| 路径 | 页面 | 说明 |
|------|------|------|
| `/my-logs` | 我的日志 | 按月查看/填报日志 |
| `/log-review` | 日志审核 | 仅项目负责人可见 |

### 8.3 普通用户（移动端）

| 路径 | 页面 | 说明 |
|------|------|------|
| `/m/my-logs` | 我的日志（移动版） | 竖屏自动跳转 |
| `/m/log-review` | 日志审核（移动版） | 竖屏自动跳转 |

> 移动端检测逻辑见 `static/js/device_redirect.js`（宽高比 &lt; 1 视为移动竖屏）。

### 8.4 管理员页面

| 路径 | 页面 | 说明 |
|------|------|------|
| `/admin/logs` | 日志查询 | 筛选、统计、导入、导出 |
| `/admin/projects` | 项目管理 | 项目 CRUD、别名、负责人 |
| `/admin/users` | 人员管理 | 审核注册、重置密码 |
| `/admin/convert` | Excel 转换 | 按月统计原始填报 Excel |

### 8.5 根路径

| 路径 | 行为 |
|------|------|
| `/` | 已登录按角色跳转；未登录跳转登录页 |

---

## 9. 功能清单

### 9.1 认证与安全

- [x] 用户注册（待管理员审核）
- [x] 登录验证码（5 分钟有效，SVG 图片）
- [x] Session 会话保持
- [x] 退出登录
- [x] 个人信息修改（姓名、密码）
- [x] 管理员重置用户密码

### 9.2 我的日志（普通用户）

- [x] 按年/月浏览每日日志
- [x] 横向日期标签，颜色标识：
  - **绿色**：已过去且有日志
  - **红色**：已过去、无日志、周一至周五
  - **黄色**：已过去、无日志、周六日
  - **灰色不可点**：今日之后的日期
- [x] 当月项目工时统计（柱状分布）
- [x] 新增日志（选项目 → 填工时/内容）
- [x] 编辑 / 删除待审核日志
- [x] 驳回后重新提交
- [x] **新增限制**：当天 17:00 后才显示「新增日志」按钮

### 9.3 日志审核（项目负责人）

- [x] 按年/月/日、人员、项目、审核状态筛选
- [x] 审核通过 / 驳回（需填写原因）
- [x] 仅可审核自己负责项目下的日志
- [x] 超过截止时间的待审日志自动通过

### 9.4 日志查询（管理员）

- [x] 多条件筛选（年/月/日、人员、项目）
- [x] 项目工时统计（表格 + 进度条）
- [x] 选择项目时显示人员投入柱形图
- [x] 日志列表合并考勤列
- [x] 导出 Excel
- [x] **导入考勤**：上传月度考勤汇总 Excel
- [x] **导入日志**：上传历史填报 Excel 并指定年份

### 9.5 项目管理（管理员）

- [x] 项目列表筛选（名称/别名、状态）
- [x] 顶部统计（总数、启用数、累计工时等）
- [x] 新增项目、编辑别名、指定负责人、启用/禁用
- [x] 仅「启用」项目可被用户填报时选择

### 9.6 人员管理（管理员）

- [x] 用户列表筛选（关键词、角色、审核状态）
- [x] 顶部统计（总人数、待审核、管理员数等）
- [x] 分页（默认 50 条/页）
- [x] 审核通过 / 拒绝
- [x] 重置密码

### 9.7 Excel 转换（管理员）

- [x] 上传原始日志填报 Excel
- [x] 指定年/月进行统计转换
- [x] 展示汇总数据与明细预览
- [x] 下载转换结果 Excel
- [x] 转换历史记录（可回看、删除）

---

## 10. 业务规则

### 10.1 日志填报

| 规则 | 说明 |
|------|------|
| 新增时间 | 当天 **17:00** 后才可新增当日日志 |
| 编辑截止 | 日志日期的 **次日 12:00** 前可新增/编辑/删除 |
| 未来日期 | 不可填报 |
| 工时精度 | 保留 2 位小数，必须 &gt; 0 |
| 项目选择 | 仅可选择「启用」状态的项目 |

### 10.2 审核流程

```
用户提交 → 待审核 (pending)
              ├→ 负责人通过 → 已通过 (approved)
              ├→ 负责人驳回 → 已驳回 (rejected) → 用户可重新提交
              └→ 超过次日 12:00 未处理 → 自动通过 (approved)
```

- 项目负责人只能审核**自己负责项目**下的日志
- 审核截止时间：日志日期的次日 12:00

### 10.3 日志查询数据范围

- 列表与统计默认仅包含 **已通过（approved）** 的日志
- 导入考勤后，无日志但有考勤的日期也会显示一行（工作内容为 `/`）

### 10.4 考勤导入匹配规则

- Excel 中的**姓名**必须与系统 `display_name`（显示名称）或 `username`（用户名）**精确匹配**
- 同一用户同一日期重复导入会**覆盖**原记录
- 优先读取「每日考勤结果」列

### 10.5 历史日志导入规则

- 需指定导入**年份**
- Sheet 命名格式：`月.日`（如 `6.1` 表示 6 月 1 日）
- 姓名、项目需与系统数据匹配
- 今日以前的记录默认 `approved`；今日及以后为 `pending`
- 同一用户 + 项目 + 日期重复则**更新**

---

## 11. API 接口

### 11.1 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/captcha` | 获取验证码 SVG |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/auth/me` | 当前用户信息 |
| PUT | `/api/auth/profile` | 更新个人信息 |

### 11.2 我的日志

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/my/logs?year=&month=` | 获取某月日志 |
| POST | `/api/my/logs` | 新增日志 |
| PUT | `/api/my/logs/<id>` | 更新日志 |
| DELETE | `/api/my/logs/<id>` | 删除日志 |
| POST | `/api/my/logs/<id>/resubmit` | 重新提交 |

### 11.3 日志审核

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/review/logs` | 查询待审/已审日志 |
| POST | `/api/review/logs/<id>/approve` | 通过 |
| POST | `/api/review/logs/<id>/reject` | 驳回 |
| GET | `/api/review/options/projects` | 负责人项目列表 |
| GET | `/api/review/options/users` | 可审核用户列表 |

### 11.4 管理员 — 人员

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/users` | 用户列表（分页） |
| GET | `/api/admin/users/summary` | 人员统计 |
| PUT | `/api/admin/users/<id>/status` | 更新审核状态 |
| PUT | `/api/admin/users/<id>/password` | 重置密码 |

### 11.5 管理员 — 项目

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/projects` | 项目列表 |
| GET | `/api/admin/projects/summary` | 项目统计 |
| POST | `/api/admin/projects` | 新增项目 |
| PUT | `/api/admin/projects` | 批量保存项目 |
| GET | `/api/projects/enabled` | 启用项目（用户填报用） |

### 11.6 管理员 — 日志查询

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/logs` | 查询日志（含考勤合并） |
| GET | `/api/admin/logs/export` | 导出 Excel |
| POST | `/api/admin/attendance/import` | 导入考勤 |
| POST | `/api/admin/logs/import` | 导入历史日志（form: file + year） |
| GET | `/api/admin/options/users` | 人员下拉选项 |
| GET | `/api/admin/options/projects` | 项目下拉选项 |

### 11.7 Excel 转换

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/convert` | 上传并转换 Excel |
| GET | `/api/download/<token>` | 下载转换结果 |
| GET | `/api/history` | 转换历史列表 |
| GET | `/api/history/<id>` | 历史详情 |
| DELETE | `/api/history/<id>` | 删除历史 |

---

## 12. 数据库说明

数据库文件：`dailay_converter.db`（与 `app.py` 同目录）

### 主要数据表

| 表名 | 说明 |
|------|------|
| `users` | 用户账号、密码哈希、角色、审核状态 |
| `projects` | 项目名称、状态、项目负责人 |
| `project_aliases` | 项目别名（用于 Excel 映射） |
| `work_logs` | 工时日志（含审核状态） |
| `attendance_records` | 考勤记录 |

### work_logs 审核字段

| 字段 | 说明 |
|------|------|
| `review_status` | `pending` / `approved` / `rejected` |
| `reject_reason` | 驳回原因 |
| `reviewed_by` | 审核人用户 ID |
| `reviewed_at` | 审核时间 |

---

## 13. Excel 文件格式说明

### 13.1 原始日志填报 Excel（转换 / 历史导入）

- 格式：`.xlsx` / `.xlsm` / `.xls`
- 每个 Sheet 名为 `月.日`（如 `4.27`、`6.1`）
- 从各 Sheet 提取：项目、姓名、工时、工作内容等
- 项目名通过 `project_mapping.json` 及数据库项目别名映射

### 13.2 考勤汇总 Excel（考勤导入）

- 格式：`.xlsx` / `.xls`
- 首行为分组标题（如「每日考勤结果」「打卡时间」）
- 次行为日期列头
- 数据行第一列为人员姓名
- 优先使用「每日考勤结果」区域的数据

### 13.3 日志查询导出 Excel

列：姓名、用户名、日期、星期、项目、工时（小时）、工作内容、考勤、创建时间

---

## 14. 项目目录结构

```
dailay-converter/
├── app.py                  # Flask 主程序与路由
├── auth.py                 # 认证装饰器
├── database.py             # 数据库与业务逻辑
├── captcha.py              # 登录验证码
├── convert_logs.py         # Excel 按月转换核心
├── log_import.py           # 历史日志导入
├── attendance_import.py    # 考勤 Excel 解析
├── project_store.py        # 项目映射读写
├── history_store.py        # 转换历史 JSON 存储
├── project_mapping.json    # 初始项目别名映射
├── requirements.txt        # Python 依赖
├── dailay_converter.db     # SQLite 数据库（运行后生成）
├── templates/              # HTML 模板
│   ├── layout.html         # 桌面布局
│   ├── layout_mobile.html  # 移动布局
│   ├── login.html / register.html
│   ├── my_logs.html
│   ├── log_review.html
│   ├── admin_logs.html
│   ├── admin_projects.html
│   ├── admin_users.html
│   ├── admin_convert.html
│   ├── mobile/             # 移动端页面
│   └── _auth_footer.html   # 登录/注册页脚
├── static/
│   ├── css/
│   │   ├── style.css       # 主样式
│   │   └── mobile.css      # 移动端样式
│   └── js/
│       ├── common.js       # 公共工具与图表
│       ├── login.js / register.js
│       ├── my_logs.js
│       ├── log_review.js
│       ├── admin_logs.js
│       ├── admin_projects.js
│       ├── admin_users.js
│       ├── admin_convert.js
│       ├── profile.js
│       ├── device_redirect.js
│       └── mobile/         # 移动端脚本
└── data/history/           # Excel 转换历史记录
```

---

## 15. 常见问题

### Q1：注册后无法登录？

注册账号默认状态为「待审核」，需管理员在 **人员管理** 中审核通过后方可登录。

### Q2：当天无法新增日志？

系统规定当天 **17:00** 后才开放「新增日志」按钮。此前只能查看已有记录。

### Q3：导入考勤/日志时提示姓名未匹配？

请确保 Excel 中的姓名与系统中用户的 **显示名称** 或 **用户名** 完全一致（区分大小写）。

### Q4：导入日志时项目未匹配？

请在 **项目管理** 中维护项目名称及别名，或检查 `project_mapping.json` 映射配置。

### Q5：下载链接失效？

Excel 转换结果通过内存缓存 Token 下载，有效期约 1 小时。请从历史记录重新打开或重新转换。

### Q6：如何备份数据？

复制 `dailay_converter.db` 文件即可。转换历史另存于 `data/history/` 目录。

### Q7：手机访问会自动跳转吗？

普通用户在竖屏移动设备上访问 `/my-logs` 会自动跳转到 `/m/my-logs`；横屏或桌面宽度则使用桌面版页面。

---

## 附录：典型使用流程

### 管理员首次部署

1. 安装依赖并启动 `python app.py`
2. 使用 `admin/admin` 登录
3. 进入 **人员管理**，审核注册用户
4. 进入 **项目管理**，维护项目与负责人
5. （可选）导入历史日志与考勤数据
6. 修改管理员默认密码

### 普通用户日常使用

1. 注册 → 等待审核 → 登录
2. 进入 **我的日志**，选择年月
3. 当天 17:00 后点击「新增日志」
4. 选择项目，填写工时与工作内容并保存
5. 等待项目负责人审核（或超时自动通过）

### 项目负责人审核

1. 登录后进入 **日志审核**
2. 筛选待审核记录
3. 逐条通过或驳回（驳回需填写原因）

### 管理员月度汇总

1. 进入 **日志查询**
2. 选择年月（及可选人员/项目）查询
3. 查看统计图表与明细列表
4. 点击「导出 Excel」下载报表

---

*文档版本：2026-07-02 · 与当前代码库功能同步*
