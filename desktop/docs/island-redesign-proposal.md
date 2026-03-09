# OmniAgent 灵动岛重设计方案

> 2026-03-02 | 综合 Apple 原版研究 + 代码审计 + UX 设计三方产出

---

## 一、设计哲学

### Apple 原版核心原则（必须遵循）

1. **活的有机体**：灵动岛是"生物形态"，不是弹窗。动画要有液体感（deliberate elasticity）
2. **内容驱动形态**：宽度由内容撑开，不留余白（snug against）
3. **信息密度分级**：Compact = 最低认知负担，Expanded = 用户主动请求
4. **克制即高级**："restrained motion reads as premium"
5. **纯黑融合**：背景 #000000，与屏幕边框视觉一体

### OmniAgent 适配原则

1. **Windows 无 TrueDepth**：我们的 Island 悬浮在屏幕顶部居中，圆角药丸
2. **AI 是核心**：音乐是附加体验，AI 对话才是主力场景
3. **工具是 Live Activity**：每个工具执行等同于一个 iOS Live Activity
4. **双进程保持**：Island (Skia 60fps) + Tauri (WebView)，但交互职责需重新划分

---

## 二、现有问题诊断

### P0 致命问题

| # | 问题 | 根因 | 文件:行号 |
|---|------|------|----------|
| 1 | **展开后无法点击收起** | `cursor_hittest=false` + `handle_click` expanded直接return | `app.rs:202,337` |
| 2 | **展开时岛缩小**(200x34) | 目标尺寸写反，应该变大不是变小 | `app.rs:408-409` |
| 3 | **收起链路断裂** | 完全依赖 Tauri 发 CollapsePanel，但 WebView 外点击不可达 | `app.rs:298` |

### P1 设计缺陷

| # | 问题 | 根因 |
|---|------|------|
| 4 | 只有2态(collapsed/expanded)，缺少 Compact/Minimal/Expanded 3态 | 形态系统未实现 |
| 5 | expansion_progress 被删除，内容无淡入淡出 | render.rs 缺失上游的进度控制 |
| 6 | 弹簧参数偏激进(0.14/0.72)，振荡感强 | 与 Apple stiffness=400/damping=30 差距大 |
| 7 | 展开视图完全缺失（上游有 main_view + tools_view） | ui/expanded/ 被删除 |

### P2 功能缺失

| # | 问题 |
|---|------|
| 8 | `get_island_border_weights` 是 stub，adaptive_border 无效 |
| 9 | `_blur_filter` 创建后未使用，motion_blur 无效 |
| 10 | 无 Minimal 态（多任务分裂） |
| 11 | 无 squircle 连续曲线圆角（只有普通 RRect） |
| 12 | 无展开触发的长按手势（目前是单击展开） |

---

## 三、形态系统重设计

### 三态 + 分裂态

```
┌─────────────────────────────────────────────────┐
│                                                 │
│   ● Compact (默认态)                             │
│   ╭──────────────────────╮                      │
│   │  [AI●]     [状态文字] │  120×37px  r=18.5    │
│   ╰──────────────────────╯                      │
│       ↓ 长按 0.5s                                │
│   ● Expanded (展开态)                            │
│   ╭──────────────────────────────────╮          │
│   │  ╭────╮                          │          │
│   │  │ 图 │  主标题                   │ 360×160  │
│   │  │ 标 │  副标题                   │ r=32     │
│   │  ╰────╯                          │          │
│   │  ─────────────────────── 进度条   │          │
│   │  [按钮1]  [按钮2]  [按钮3]        │          │
│   ╰──────────────────────────────────╯          │
│       ↓ 第二个活动加入                            │
│   ● Split (分裂态)                               │
│   ╭──────────╮              ╭────╮              │
│   │ [AI●] hi │              │ ♪♪ │              │
│   ╰──────────╯              ╰────╯              │
│   (主活动 Compact)      (次活动 Minimal)          │
│   Minimal: 36×36px r=18 (近圆形)                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 精确尺寸规范（Windows 150% DPI）

| 形态 | 宽度 | 高度 | 圆角 | 说明 |
|------|------|------|------|------|
| Compact | 120-240px (内容自适应) | 37px | 18.5px | 默认态 |
| Expanded | 360px | 84-160px (内容自适应) | 32px | 长按展开 |
| Minimal | 36px | 36px | 18px | 多任务次要活动 |

### 圆角：Squircle 连续曲线

Apple 用 `cornerCurve = .continuous`（超椭圆），不是普通圆角。Skia 实现方式：

```rust
// 用三次贝塞尔曲线逼近 squircle
// 控制点系数 k ≈ 0.5522847498 (标准圆弧)
// squircle 用 k ≈ 0.6 获得更平滑过渡
fn draw_squircle(canvas: &Canvas, rect: Rect, radius: f32, paint: &Paint) {
    let k: f32 = 0.6; // squircle 系数 (普通圆角是 0.5523)
    let mut path = skia_safe::Path::new();
    // ... 用 cubic_to 绘制四角连续曲线
}
```

---

## 四、动画系统重设计

### 弹簧参数对照

| 用途 | 现有参数 | Apple 黄金比例 | 建议值 |
|------|---------|---------------|--------|
| 主形变 (w/h) | stiffness=0.14, damping=0.72 | stiffness=400, damping=30 | **stiffness=0.12, damping=0.65** |
| 圆角 (r) | 同上 | 同上 | stiffness=0.15, damping=0.60 |
| 内容淡入 | 无 | opacity spring | stiffness=0.20, damping=0.55 |
| 分裂移动 | 无 | metaball spring | stiffness=0.10, damping=0.70 |

> 注意：我们的弹簧是自定义离散步进模型（每帧一次），Apple 的 stiffness/damping 是 UIKit 连续积分。
> 上面的"建议值"是在我们的 `Spring::update` 公式下调参的结果，效果接近 Apple 的"快速弹出、平滑衰减、极少过冲"。

### 弹簧公式优化

现有公式存在过冲问题，建议改为临界阻尼优先：

```rust
pub fn update(&mut self, target: f32, stiffness: f32, damping: f32) {
    let force = (target - self.value) * stiffness;
    self.velocity = (self.velocity + force) * damping;
    self.value += self.velocity;
    // 新增：临界阻尼收敛 (消除微振荡)
    if (self.value - target).abs() < 0.5 && self.velocity.abs() < 0.1 {
        self.value = target;
        self.velocity = 0.0;
    }
}
```

### 动画时序编排

**Compact → Expanded (展开)**：
```
t=0ms      形状开始膨胀 (spring w/h/r 向 expanded 目标)
t=100ms    Compact 内容开始淡出 (opacity 1→0, 100ms)
t=150ms    Expanded 内容开始淡入 (opacity 0→1, blur 8→0, 200ms)
t=400ms    形变基本完成
t=500ms    所有元素就位
```

**Expanded → Compact (收起)**：
```
t=0ms      Expanded 内容淡出 (opacity 1→0, blur 0→8, 150ms)
t=100ms    形状开始收缩 (spring)
t=150ms    Compact 内容开始淡入 (opacity 0→1, 100ms)
t=400ms    收缩完成
```

**Split 分裂动画**：
```
t=0ms      主岛右侧开始"鼓包"
t=100ms    鼓包分离，metaball 拉丝效果
t=200ms    拉丝断裂，第二气泡向右弹出
t=350ms    两个气泡各自到达目标位置
```

---

## 五、交互重设计

### 手势映射（对齐 Apple）

| 手势 | Compact 态 | Expanded 态 | Minimal 态 |
|------|-----------|-------------|------------|
| **单击** | 打开 Tauri 主窗口 | 打开 Tauri 主窗口 | 展开该活动 |
| **长按 0.5s** | 展开到 Expanded | — | — |
| **外部点击** | — | 收起到 Compact | — |
| **上滑** | — | 收起到 Compact | — |
| **3s无操作** | — | 自动收起 | — |

### P0 Bug 修复方案

**方案：Island 层重新接管展开态交互**

```rust
// app.rs — 修复 handle_click
fn handle_click(&mut self, win: Arc<Window>) {
    let (px, py) = get_global_cursor_pos();
    let rel_x = (px - self.win_x) as f64;
    let rel_y = (py - self.win_y) as f64;

    if self.expanded {
        // 展开态：点击 pill 头部区域 → 打开 Tauri 主窗口
        // 点击 expanded 内容区域 → Island 自己处理
        // 点击外部 → 收起
        let in_island = is_point_in_island(rel_x, rel_y, ...);
        if !in_island {
            self.collapse();
        }
        // 不再 return，保持事件处理
    } else {
        // 收起态：检测长按（需要新增 press_start 计时）
        self.press_start = Some(Instant::now());
    }
}

// 新增：长按检测
fn handle_release(&mut self, win: Arc<Window>) {
    if let Some(start) = self.press_start.take() {
        if start.elapsed() >= Duration::from_millis(500) {
            // 长按 → 展开
            self.expand();
        } else {
            // 短按 → 通知 Tauri 打开主窗口
            if let Some(ref ipc) = self.ipc {
                ipc.send(IslandToTauri::ExpandRequested);
            }
        }
    }
}

// 修复 cursor_hittest — 展开时不再穿透
fn update_cursor_hittest(&mut self, window: &Arc<Window>) {
    let want = if self.expanded {
        // 展开时：整个 expanded 区域都接收点击
        let (px, py) = get_global_cursor_pos();
        is_point_in_expanded_area(px, py, ...)
    } else {
        // 收起时：只在 pill 区域接收
        let (px, py) = get_global_cursor_pos();
        is_point_in_pill(px, py, ...)
    };
    // ...
}
```

**展开尺寸修复**：

```rust
// app.rs:408 — 修改前（错误：展开时缩小）
let target_w = (if self.expanded { 200.0 } else { target_base_w }) * scale;
let target_h = (if self.expanded { 34.0 } else { self.config.base_height }) * scale;

// 修改后（正确：展开时膨胀）
let target_w = (if self.expanded { self.config.expanded_width } else { target_base_w }) * scale;
let target_h = (if self.expanded { self.config.expanded_height } else { self.config.base_height }) * scale;
```

---

## 六、8 场景视觉适配方案

### 场景 1：AI 对话（核心场景）

**Compact 态**：
```
╭──────────────────────────╮
│  ●  正在思考...            │   ← AI状态点 + 最新一句摘要
╰──────────────────────────╯
    ●=蓝色脉冲(thinking) / 绿色常亮(streaming) / 灰色(idle)
```
- 宽度：内容自适应，最小120px，最大240px
- AI 状态点：左侧 12px 处，半径 3.5px
- 文字：最新回复摘要，12px，单行截断

**Expanded 态**：
```
╭──────────────────────────────────────╮
│  ╭────╮                              │
│  │ AI │  最近的回复内容                │
│  │ ●● │  最多3行预览...               │
│  ╰────╯                              │
│  ──────────────────────────────────  │
│  [💬 打开对话]          [📎 附件]      │
╰──────────────────────────────────────╯
```
- Leading：AI 头像/Logo (40×40px, r=12)
- Center：最新回复预览 (最多3行，13px)
- Bottom：快捷操作按钮

**状态动画**：
| AI状态 | Compact表现 | 动画 |
|--------|------------|------|
| Idle | 灰色半透明点 | 无 |
| Thinking | 蓝色脉冲点 | sin(t*0.05)*0.5+0.5 → alpha |
| Streaming | 绿色呼吸点 + 文字滚动 | 文字从右滑入左滑出 |
| Complete | 绿色闪一下 → 渐变回idle | 0.5s 闪烁 → 2s 渐隐 |
| Error | 红色点 | 快速双闪 |

**新增 IPC 消息**：
```rust
// Tauri → Island
AiStateChanged { state: AiState, snippet: Option<String> }
// 合并现有 AiStateChanged + ChatSnippet 为一条消息
```

---

### 场景 2：音乐播放器

**Compact 态**（保持上游 WinIsland 风格，微调）：
```
╭────────────────────────────────╮
│  [🎵]  歌曲名 - 艺术家   |||   │   ← 封面 + 标题 + 频谱
╰────────────────────────────────╯
```
- Leading：专辑封面 (18×18px, r=5)
- Center：歌曲名（歌词模式下显示歌词）
- Trailing：6条频谱柱（现有 draw_visualizer 保留）

**Expanded 态**：
```
╭──────────────────────────────────────╮
│  ╭──────╮                            │
│  │      │  歌曲名                     │
│  │ 封面  │  艺术家                     │
│  │      │                            │
│  ╰──────╯                            │
│  ████████████░░░░░░░░  2:31 / 3:45   │
│     ⏮      ▶      ⏭                 │
╰──────────────────────────────────────╯
```
- Leading：专辑封面 (52×52px, r=10)
- Center：歌曲名 (15px bold) + 艺术家 (13px gray)
- Bottom：进度条 + 控制按钮

---

### 场景 3：通知

**弹出动画**（自动触发，无需用户操作）：
```
t=0ms     Compact 态短暂膨胀（宽度+20px，0.2s spring）
t=0ms     通知内容淡入
t=3000ms  内容淡出，形状回弹到原尺寸
```

**Compact 态**（通知弹出时）：
```
╭────────────────────────────────╮
│  [👤]  张三: 会议改到3点         │
╰────────────────────────────────╯
```

**Expanded 态**（长按通知区域）：
```
╭──────────────────────────────────────╮
│  ╭────╮                              │
│  │ 头  │  张三                        │
│  │ 像  │  会议改到3点，请确认          │
│  ╰────╯                              │
│  [👍 确认]    [💬 回复]    [✕ 忽略]    │
╰──────────────────────────────────────╯
```

**新增 IPC 消息**：
```rust
// Tauri → Island
ShowNotification { title: String, body: String, icon: Option<String>, auto_dismiss_ms: u64 }
DismissNotification
```

---

### 场景 4：工具执行

**Compact 态**：
```
╭──────────────────────────╮
│  [🖼]  生成中... 63%      │   ← 工具图标 + 进度
╰──────────────────────────╯
```

**Expanded 态**（图片生成为例）：
```
╭──────────────────────────────────────╮
│  ╭──────╮                            │
│  │ 预览  │  图片生成                   │
│  │ 缩略  │  "一只穿西装的猫"           │
│  │  图   │                            │
│  ╰──────╯                            │
│  ████████████████░░░░  78%            │
│  [取消]                    [打开]      │
╰──────────────────────────────────────╯
```

**完成态**（工具执行完毕，短暂展示结果）：
```
╭────────────────────────────╮
│  [✓]  图片已生成             │   ← 绿色打钩 + 完成信息
╰────────────────────────────╯
   ↓ 2s后自动收回 idle
```

**新增 IPC 消息**：
```rust
// Tauri → Island
ToolProgress { tool_id: String, tool_name: String, icon: String, progress: f32, status: ToolStatus }
// enum ToolStatus { Running, Complete, Error }
```

---

### 场景 5：语音

**Compact 态**（录音中）：
```
╭────────────────────────────╮
│  🔴  00:32  ~~~~           │   ← 红点 + 时长 + 声波
╰────────────────────────────╯
```

**Expanded 态**：
```
╭──────────────────────────────────────╮
│              录音中                    │
│  ~~~~~~~~~~~~~~~~~~~~~~~~~~          │
│              00:32                    │
│        [⏸ 暂停]    [⏹ 停止]          │
╰──────────────────────────────────────╯
```

**新增 IPC 消息**：
```rust
VoiceStateChanged { state: VoiceState, duration_ms: u64, waveform: Option<Vec<f32>> }
// enum VoiceState { Recording, Recognizing, Speaking, Idle }
```

---

### 场景 6：计时器

**Compact 态**：
```
╭──────────────────╮
│  🍅  23:41        │   ← 番茄图标 + 倒计时
╰──────────────────╯
```

**Expanded 态**：
```
╭──────────────────────────────────────╮
│                                      │
│           ╭─────────╮                │
│           │  23:41  │  ← 圆形进度环  │
│           ╰─────────╯                │
│                                      │
│     [暂停]              [取消]        │
╰──────────────────────────────────────╯
```

---

### 场景 7：文件拖拽

```
拖入前 (Compact):     ╭──────────╮
                      │  AI ●    │
                      ╰──────────╯

拖入时 (Hover):       ╭──────────────────╮
                      │    📁 放开以上传    │  ← 蓝色发光边框 + 膨胀
                      ╰──────────────────╯

放开后 (Processing):  ╭──────────────────╮
                      │  [📄] 处理中...    │  ← 吸入动画 → 进度
                      ╰──────────────────╯
```

**动画序列**：
```
文件进入窗口 → Island 宽度 spring 到 +30px，蓝色发光描边渐入
文件放开     → "吸入"动画（文件图标从鼠标位置飞入 Island）
处理中       → 进入工具执行场景
```

---

### 场景 8：多任务分裂

当两个 Live Activity 同时运行（如：AI 对话 + 音乐播放）：

```
╭──────────────╮    ╭────╮
│  ●  思考中...  │    │ ♪♪ │
╰──────────────╯    ╰────╯
  (主活动:AI)     (次活动:音乐)
```

**优先级规则**：
| 优先级 | 场景 | 分裂时位置 |
|--------|------|----------|
| 1 (最高) | AI 对话（Thinking/Streaming） | 主活动(Leading) |
| 2 | 通知 | 自动展开，不分裂 |
| 3 | 工具执行 | 主活动(Leading) |
| 4 | 音乐 | 次活动(Minimal) |
| 5 | 计时器 | 次活动(Minimal) |

**分裂动画**（metaball 风格）：
```
单气泡 → 右侧鼓包 → 拉丝分离 → 两个独立气泡
合并：靠近 → 表面张力吸附 → 融合
```

**新增 IPC + App 状态**：
```rust
// App 结构体新增
split_mode: SplitMode,  // None / Split { primary: ActivityType, secondary: ActivityType }
spring_split_x: Spring, // 分裂间距弹簧

// IPC
TauriToIsland::SetSplitMode { primary: ActivityType, secondary: Option<ActivityType> }
```

---

## 七、IPC 协议重设计

### 现有消息（保留）

```rust
// Island → Tauri
Ping, ExpandRequested, CollapseRequested, ToolSelected,
FileDropped, DragHovering, GlobalHotkeyPressed, RequestToolGrid

// Tauri → Island
Pong, Shutdown, FlashIsland, CollapsePanel, ToolGridData
```

### 新增消息

```rust
// Island → Tauri（新增）
ChatInputSubmitted { text: String }  // 已有，保留
LongPressExpand                      // 长按触发展开（取代原 ExpandRequested 的部分语义）
TapOpenApp                           // 单击打开主窗口

// Tauri → Island（新增/合并）
AiUpdate { state: AiState, snippet: Option<String> }   // 合并 AiStateChanged + ChatSnippet
ShowNotification { id: String, title: String, body: String, icon: Option<String>, ttl_ms: u64 }
DismissNotification { id: String }
ToolProgress { tool_id: String, name: String, icon: String, progress: f32, status: ToolStatus }
VoiceUpdate { state: VoiceState, duration_ms: u64, waveform: Option<[f32; 8]> }
TimerUpdate { label: String, remaining_ms: u64, total_ms: u64 }
SetActivity { primary: ActivityType, secondary: Option<ActivityType> }

// 新增 enum
enum ToolStatus { Running, Complete, Error }
enum VoiceState { Recording, Recognizing, Speaking, Idle }
enum ActivityType { Ai, Music, Notification, Tool, Voice, Timer }
```

---

## 八、关键代码改动清单

### Phase 1：修 Bug + 基础形态（1-2天）

| 文件 | 改动 | 优先级 |
|------|------|--------|
| `app.rs:202` | handle_click 不再在 expanded 时 return，增加长按检测 | P0 |
| `app.rs:337` | cursor_hittest expanded 时保持 true | P0 |
| `app.rs:408` | 展开目标改为 expanded_width/expanded_height | P0 |
| `physics.rs` | Spring 增加临界阻尼收敛 | P1 |
| `app.rs:411` | 弹簧参数调整为 0.12/0.65 | P1 |

### Phase 2：3 态系统 + 内容过渡（3-5天）

| 文件 | 改动 |
|------|------|
| `app.rs` | 新增 `IslandState` enum (Compact/Expanded/Minimal)，替代 bool expanded |
| `app.rs` | 新增 expansion_progress 计算（基于 spring_h 位移比例） |
| `render.rs` | 恢复 expansion_progress 驱动的内容淡入淡出 |
| `render.rs` | 新增 draw_expanded_content() — Expanded 态四区域布局 |
| `ui/` | 新建 `ui/compact.rs` + `ui/expanded.rs`，分离两态渲染逻辑 |
| `ipc.rs` | 新增 AiUpdate / ShowNotification / ToolProgress 等消息类型 |
| `config.rs` | AppConfig 增加 long_press_ms, auto_collapse_ms 配置 |

### Phase 3：工具适配 + 分裂态（5-7天）

| 文件 | 改动 |
|------|------|
| `app.rs` | 新增 `split_mode` + `spring_split_x` + 多活动管理 |
| `render.rs` | 新增 draw_split_mode() — 双气泡渲染 + metaball 效果 |
| `render.rs` | 每个 ActivityType 独立的 compact/expanded 渲染函数 |
| `ui/activities/` | 新建目录，每个场景一个文件 (ai.rs, music.rs, notification.rs, tool.rs, voice.rs, timer.rs) |
| `ipc.rs` | 完整新增 VoiceUpdate / TimerUpdate / SetActivity 消息 |
| `utils/squircle.rs` | 新增 squircle 连续曲线实现 |

### Phase 4：打磨动画 + 边界体验（3-5天）

| 文件 | 改动 |
|------|------|
| `render.rs` | 完善所有过渡动画时序 |
| `utils/blur.rs` | motion_blur 真正生效 |
| `utils/color.rs` | adaptive_border 真正实现（屏幕截图采样） |
| `app.rs` | 自动收起计时器 (3s) |
| `app.rs` | 通知自动弹出+消退动画 |

---

## 九、实施路线图

```
Week 1 (Phase 1+2前半)
├── Day 1: P0 bug 全部修复，能正常展开/收起
├── Day 2: 弹簧参数调优，展开尺寸修正
├── Day 3-4: 3态 enum，expansion_progress 恢复
└── Day 5: 内容淡入淡出时序调通

Week 2 (Phase 2后半+3前半)
├── Day 1-2: Expanded 态四区域布局
├── Day 3: AI 对话场景完整适配
├── Day 4: 音乐播放器场景微调
└── Day 5: 通知弹出场景

Week 3 (Phase 3后半+4)
├── Day 1-2: 工具执行 + 语音 + 计时器场景
├── Day 3: 多任务分裂态
├── Day 4: Squircle + adaptive_border + motion_blur
└── Day 5: 全场景打磨 + 边界情况处理
```

---

## 十、设计参考资料

- [Apple Dynamic Island 完整研究报告](../apple-dynamic-island-research.md)
- [WWDC23 - Design dynamic Live Activities](https://developer.apple.com/videos/play/wwdc2023/10194/)
- [WWDC23 - Animate with springs](https://developer.apple.com/videos/play/wwdc2023/10158/)
- [cho.sh - Recreating the Dynamic Island](https://cho.sh/w/9F7F85)（Spring 黄金参数来源）
- [WinIsland 上游代码](../island-upstream/)（原始展开视图参考）
