# 宠物社交互动实施计划

- 状态：已确认并完成 MVP 开发与 Windows 独立桌面真机验证，待交付确认

- 对应需求：`PET-SOCIAL-REQUIREMENTS.md`

- 开发分支：`feature/pet-social`

- 基线：`upstream/main` / `fb38ce6`

## 1. 实施策略

采用 “独立社交模块 + 单点装配” 的方式：

- 新功能集中在 `dsh-pet/src/host/social/`。

- 配置与记忆使用独立用户文件。

- 通过现有 `MenuRegistry` 接入右键菜单。

- 通过现有模型、人设、状态、锁、语音函数完成互动。

- 社交模块内部注册自己的生命周期清理。

- 上游 `host/index.ts` 只增加一次 import 和一次装配调用。

- 不改渲染端、主人聊天、主配置、状态协议和公开 HTTP API。

## 2. 目标结构

```
dsh-pet/src/host/social/
├── index.ts              # 功能装配与生命周期入口
├── director.ts           # 会话状态机、组锁、轮流发言与取消
├── generate.ts           # 人设与社交上下文拼装、模型结果清洗
├── memory.ts             # 独立社交历史读写、窗口与容量限制
├── config.ts             # 独立配置读取、校验与默认值
├── menu.ts               # 菜单注册与点击消费循环
├── types.ts              # 配置、会话、消息和依赖类型
├── director.test.ts
├── generate.test.ts
├── memory.test.ts
└── config.test.ts
```

文件可按实际实现适度合并，但不把社交逻辑塞入上游现有模块。

用户数据：

```
$DSH_HOME/dsh-pet/
├── social-config.json
└── social-memory.json
```

## 3. 上游文件改动预算

| 文件                         | 计划改动                                                              | 冲突风险             |
| ---------------------------- | --------------------------------------------------------------------- | -------------------- |
| `dsh-pet/src/host/index.ts`  | 增加社交模块 import；在基础服务就绪后调用一次 `createSocialFeature()` | 低～中，仅限几行装配 |
| `PET-SOCIAL-REQUIREMENTS.md` | 需求与确认结果                                                        | 低，本分支新增       |
| `PET-SOCIAL-PLAN.md`         | 计划、进度与后续同步记录                                              | 低，本分支新增       |

MVP 不计划修改：

- `host/chat.ts`

- `host/plugin/chat-memory.ts`

- `host/plugin/loops.ts`

- `host/plugin/lifecycle.ts`

- `host/config/*`

- `shared/config.ts`

- `shared/types.ts`

- `shared/state.ts`

- `shared/menu*`

- `client/*`

- `runtime/electron-helper/*`

- `package.json` 与锁文件

- `API.md` 与 `openapi.yaml`

若实现中发现必须修改上述文件，先暂停并说明原因、替代方案和同步影响，不直接扩大改动范围。

## 4. 模块职责与复用接口

### 4.1 `social/config.ts`

- 读取独立 JSON 配置。

- 校验版本、开关、回合数、间隔、历史窗口和文本长度。

- 对缺失或非法字段使用默认值。

- 每次开始会话重新读取，返回不可变快照。

### 4.2 `social/memory.ts`

- 读取和追加 `social-memory.json`。

- 提供同一对宠物的最近消息查询。

- 限制最多 20 场、200 条消息。

- 串行化写入，避免同场末尾写入与下一场启动互相覆盖。

- 对损坏数据降级，不影响宿主其他功能。

### 4.3 `social/generate.ts`

复用：

- `readAllConfig()` / `findPetInstance()`：定位宠物与所属条目。

- `petPersona()`：取得生效人设。

- `composeSystemPrompt()`：复用项目已有时间、环境和人格拼装方式。

- `generateChat()`：调用当前模型服务，传空图片池和空动作列表。

新增：

- 社交专用说明：对方是宠物，不是主人。

- 把共同上下文转换为当前发言者视角的历史。

- 清洗空文本、多余换行、Markdown 和超长结果。

- 只返回文本，不解析动作、坐标或图片。

### 4.4 `social/director.ts`

负责唯一会话状态机：

```
idle → acquiring → speaking → waiting → speaking → finished
                   ├──────────────→ cancelled
                   └──────────────→ failed
```

职责：

- 选择另一名参与者。

- 按固定顺序获取双方锁并回滚部分成功。

- 保存 `petId → lockId`，在生成前和生成后验证持有状态。

- 按 A/B 交替生成并发布台词。

- 使用 `pickVoiceSurface()` 设置 `voiceTo`。

- 使用现有 `say` 叶子和 `duration` 字段展示气泡。

- 在 `finally` 中释放本场仍持有的锁。

- 取消后忽略晚到的模型结果。

- 不让会话自行创建下一场会话。

### 4.5 `social/menu.ts`

- 以 `pet-social` 为 owner 注册两个菜单项。

- 使用 `MenuRegistry.poll()` 消费点击。

- 同一时间只有一个菜单消费者。

- 功能关闭或插件卸载时清理注册与等待。

- 不修改网页和 Electron 菜单代码。

### 4.6 `social/index.ts`

- 接收宿主已有对象，不自行创建第二份 `LockStore`、`PollStateStore` 或 `MenuRegistry`。

- 配置启用时才启动菜单循环。

- 通过 `ctx.effect()` 注册清理。

- 清理顺序：标记 disposed → 取消当前会话 → 停止菜单循环 → 清理菜单 owner → 释放锁。

## 5. `host/index.ts` 装配位置

社交功能只依赖 `createHostSetup()` 与 `createPetLookup()` 已创建的对象，装配放在 `petLookup` 创建完成后即可。语音合成仍由现有渲染端根据 `say.voiceTo` 触发，社交模块不直接调用语音服务。

计划传入：

```
createSocialFeature({
  ctx,
  configPaths,
  userRoot,
  log,
  state: setup.state,
  lock: petLookup.lock,
  sleep: petLookup.sleep,
  menuRegistry: setup.menuRegistry,
});
```

不新增全局服务，不把社交对象加入 `PetRouteDeps`，不扩展公开路由。

## 6. 实施步骤

### 阶段 A：纯逻辑与测试

1. 新建 `types.ts`、`config.ts`。

2. 完成独立配置读取与默认值测试。

3. 新建 `memory.ts`，完成空文件、损坏文件、容量限制和同角色历史窗口测试。

4. 新建 `generate.ts`，用注入的模型函数测试双方视角、人设隔离和文本清洗。

确认点：纯逻辑测试通过，尚未触碰实时宠物状态。

### 阶段 B：会话状态机

1. 新建 `director.ts`，所有外部能力通过接口注入。

2. 用 fake state /lock/generator 测试完整四轮互动。

3. 覆盖组锁回滚、手动取消、用户抢占、模型失败、晚到结果和重复启动。

4. 覆盖结束后记忆写入与锁释放。

确认点：不依赖真实模型即可证明状态机安全。

### 阶段 C：菜单与宿主装配

1. 新建 `menu.ts` 和 `index.ts`。

2. 在 `host/index.ts` 增加最小装配接线。

3. 确认功能关闭时零菜单、零循环、零模型调用。

4. 确认插件卸载后没有挂起轮询、定时器和残留锁。

确认点：只新增社交目录及 `host/index.ts` 少量改动。

### 阶段 D：真实联调

1. 准备两只可见宠物与不同 `whisperPrompt`。

2. 启用 `social-config.json`。

3. 分别在网页和桌面验证右键开始、四次交替发言、语音和结束互动。

4. 验证睡觉、占用、模型失败和用户抢占。

5. 检查 `memory.json` 未写入社交内容，`social-memory.json` 记录正确。

### 阶段 E：检查与交付

1. 运行社交模块测试。

2. 运行项目现有测试和静态检查。

3. 检查 `git diff --stat` 与最终文件清单，确认没有范围外修改。

4. 在计划文档记录实际改动、测试结果和遗留边界。

5. 交付可运行结果；是否提交、推送或向上游发 PR 由用户另行确认。

## 7. 测试清单

### 单元测试

- 配置缺省、关闭、非法值和边界值。

- 历史为空、损坏、裁剪、同角色过滤与串行写入。

- A/B 视角历史转换与文本长度限制。

- 无伙伴、已有会话、睡觉、占用与组锁回滚。

- 四轮顺序、手动结束、用户抢占与模型失败。

- 取消后晚到结果不写状态、不写记忆。

- 卸载后菜单与定时器清理。

### 回归检查

- 主人 `/chat` 和 `memory.json` 行为不变。

- 碎碎念、随机动作、第三方占用锁行为不变。

- 网页和桌面右键菜单原功能不变。

- 功能关闭时不产生额外模型调用和后台循环。

## 8. 上游同步规则

1. `main` 只跟踪官方上游，不提交社交功能代码。

2. 社交开发只发生在 `feature/pet-social`。

3. 同步时先 `fetch upstream`，让 `main` 以 `--ff-only` 更新，再将 `main` 合入或 rebase 到功能分支。

4. 不全仓格式化，不批量整理 import，不修改无关测试。

5. 每次同步重点检查以下接口：

   - `host/index.ts` 的装配顺序和依赖构造；
   - `generateChat()`、`composeSystemPrompt()`、`petPersona()` 签名；
   - `LockStore`、`MenuRegistry`、`PollStateStore` 接口；
   - `pickVoiceSurface()` 和语音字段语义。

6. 若上游后来实现原生社交能力，优先评估迁移到上游实现，而不是长期维护两套并行协议。

## 9. 里程碑与确认门

| 里程碑          | 产物                                   | 是否需再次确认                 |
| --------------- | -------------------------------------- | ------------------------------ |
| M0              | 开发分支、需求文档、实施计划           | 已完成并确认                   |
| M1              | 配置、记忆、生成与状态机单元测试       | 否，按确认范围执行             |
| M2              | 菜单接入、宿主装配、完整手动互动       | 否，按确认范围执行             |
| M3              | 两端联调、测试与交付                   | 是，提交 / 推送前确认          |
| M4 后续独立需求 | 自动触发、位置互动、独立音色、关系系统 | **是，重新评估范围与上游冲突** |

## 10. 当前状态与验证记录

- 已配置 `upstream` 并获取官方上游。
- 本地 `main` 与 `upstream/main` 基线一致。
- 已在 `feature/pet-social` 完成 MVP 源码，未提交、未推送。
- 新增 `dsh-pet/src/host/social/` 独立模块；上游源码仅 `host/index.ts` 增加 2 行装配。
- 未修改主人聊天、主配置、共享状态、渲染端、公开 API、依赖清单或锁文件。
- 社交模块测试：19 项全部通过。
- 配置并发与构建钩子回归：7 项全部通过。
- `pnpm run typecheck`：通过。
- `pnpm run lint`：通过。
- `pnpm run build`：通过。
- Prettier 检查：通过。
- 全量测试：2750 通过、0 失败、1 跳过、14 取消。14 个取消均为未修改的主人聊天记忆、模型或语音超时测试中的 `Promise resolution is still pending but the event loop has already resolved`；主人聊天记忆文件单独运行也可复现。
- Windows 独立桌面真机：真实菜单事件完成四轮交替对话，第二次会话承接历史，四次语音合成调用成功；独立社交记忆正确，主人 `memory.json` 未检出社交台词。
- 手动结束真机验证：首条后停止，等待 12 秒无新增记录；应用正常退出，原主配置按 SHA-256 校验恢复，测试配置与记忆已归档到临时目录。
- 真机修复：独立模式要求首条历史为 `user`；在社交历史转换中补充开场上下文后四轮通过，未扩大上游文件改动范围。
- 尚未进行物理右键点击、截图和人工听音（桌面控制工具不可用）；网页端及睡觉/占用/拖拽抢占仍待人工联调。
- 等待用户确认交付；提交、推送和向上游发 PR 仍需另行确认。
