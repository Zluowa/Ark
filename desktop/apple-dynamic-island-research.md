# Apple Dynamic Island 完整设计规范研究报告

> 研究日期：2026-03-02
> 研究者：research-assistant
> 研究深度：深度

---

## 研究目标

系统整理苹果 Dynamic Island 的完整设计规范，包括形态系统、动画参数、各类 Live Activity 的视觉表现、交互设计原则，为 OmniAgent Desktop 灵动岛的设计重构提供第一性原理参考。

---

## 核心发现

### 关键洞察1：Dynamic Island 是"活的有机体"，不是弹窗

苹果的设计哲学核心是"biological form and motion"——灵动岛被刻意设计成有生命的有机体感，而非通知弹窗。它的动画有"deliberate elasticity"（刻意弹性），形变时像液体流动。设计目标是让用户感受不到它是一个硬件摄像头孔。

**证据**：
- WWDC23 "Design dynamic Live Activities" 明确表述：inspired by biological form
- 社区重建实验（cho.sh）发现 spring stiffness=400, damping=30 是"黄金比例"
- 苹果文档强调"living organism feel"

### 关键洞察2：内容永远服务于形态，不是反过来

形态由内容驱动自适应，宽度由内容撑开，高度有严格上限。不是先定一个大框再填内容。

**证据**：
- 官方设计原则：Island width should be "as narrow as possible"
- 内容必须与传感器区域"snug against"（紧贴）
- 宽度随内容自适应，高度上限 160pt

### 关键洞察3：三种形态是严格的信息密度分级

形态不是随意展开的，是严格对应"用户当前注意力投入程度"的分级系统：
- Compact：用户在做其他事，给最小感知负担
- Expanded：用户主动请求更多信息（长按触发）
- Minimal：系统资源争夺时的最小存在

---

## 形态系统详细规范

### 1. Compact（紧凑态）

**触发条件**：有单个 Live Activity 运行时的默认状态

**形状**：横跨摄像头两侧的胶囊，左右两个区域通过软件"粘连"在一起

**精确尺寸**（官方参考值）：
| 设备 | Leading 宽度 | Trailing 宽度 | 高度 |
|------|-------------|--------------|------|
| iPhone 14 Pro (390pt 逻辑宽) | 52pt | 52pt | 37pt |
| iPhone 14 Pro Max (430pt 逻辑宽) | 62pt | 62pt | 37pt |
| iPhone 15/16 Pro | 同 14 Pro 规格 | 同左 | 37pt |

**内容规则**：
- 图标/图片：24pt（含边距的 bounding box）
- 文字：15pt SF Pro，line height 22pt
- Leading 侧：通常放图标、应用标识
- Trailing 侧：通常放数字、时间、进度等关键数据
- 禁止在任何一侧放"指向 Island"的 UI 箭头
- 禁止静态链接，内容必须是实时信息

**圆角**：连续曲线（squircle，iOS 的 `.cornerCurve = .continuous`），与摄像头硬件圆角同心，44pt 圆角半径与 TrueDepth 摄像头对应

**背景**：纯黑，融入屏幕上方黑色边框，造成"孔洞扩张"视觉效果

---

### 2. Expanded（扩展态）

**触发条件**：用户长按 Compact 态，或系统接收到高优先级提醒时自动展开

**形状**：从 Compact 形态向下扩展的大胶囊

**精确尺寸**：
| 设备 | 宽度 | 高度范围 |
|------|------|---------|
| iPhone 14 Pro | 371pt | 84pt（小）~ 160pt（大上限） |
| iPhone 14 Pro Max | 471pt | 84pt（小）~ 160pt（大上限） |

**布局四区域**（L形结构）：
```
┌─────────────────────────────────┐
│  [leading]  [camera]  [trailing] │  ← 摄像头行（与 compact 同高）
├─────────────────────────────────┤
│  [            center           ] │  ← 摄像头下方中心区
│  [            bottom           ] │  ← 底部扩展区
└─────────────────────────────────┘
```

- **Leading 区**：摄像头左侧，L形延伸至下方，通常放专辑封面/头像（大图）
- **Trailing 区**：摄像头右侧，L形延伸，通常放控制按钮
- **Center 区**：摄像头正下方，主要信息区
- **Bottom 区**：最底部，次要信息/进度条

**内容原则**：
- "Capture the essence of the activity"（本质，不是全部）
- 感觉像"app 的迷你版"，保持与 compact 的视觉连续性
- 顶部不要留"额头"（forehead）空白，内容要顶住传感器区域
- 元素位置要与 compact 态对应，保持空间连贯性

---

### 3. Minimal（最小态）

**触发条件**：同时有两个 Live Activity 运行时，优先级低者进入 Minimal 态

**两个气泡的分配规则**：
- 主活动（Leading）：附着在 Dynamic Island 左侧，保持完整胶囊形状
- 次活动（Trailing）：分离成独立小圆圈，悬浮在 Island 右侧

**Minimal 气泡尺寸**：约 36pt × 36pt（近似圆形）

**内容要求**：
- 不能只显示应用图标
- 必须用动态内容传达活动状态
- 极度受限空间内仍需维持活动身份标识

---

## 动画系统

### 弹簧参数（Spring Animation）

**Apple 官方新参数体系（iOS 17 / WWDC23 引入）**：
```swift
// 推荐写法：duration + bounce
withAnimation(.spring(duration: 0.5, bounce: 0.15)) { ... }

// 物理参数换算公式
stiffness = (2π ÷ duration)²
damping = 1 - 4π × bounce ÷ duration  // bounce ≥ 0 时
damping = 4π ÷ (duration + 4π × bounce)  // bounce < 0 时
```

**社区逆向工程得出的最接近原版参数（Framer Motion / Web 实现）**：
```js
// "黄金比例" - 社区通过视觉对比发现
stiffness: 400
damping: 30
// 换算为 Apple 参数约：duration ≈ 0.5s, bounce ≈ 0.12
```

**总体动画时长**：0.3s ~ 0.5s（响应快而不突兀）

### 形态切换动画序列

**Compact → Expanded（展开）**：
1. 形状先开始变形（宽度向两侧扩展，高度向下增长）
2. 内容在形变完成前约 1/3 处开始淡入（非等形变完成）
3. 两者有重叠，形变主导，内容随之出现
4. 文字从模糊到清晰（blur 过渡）
5. 总时长约 0.4-0.5s

**Expanded → Compact（收起）**：
1. 内容先淡出/缩小
2. 形状随后收缩回胶囊
3. 先内容消失，后形变收缩（与展开相反）

**单气泡 → 双气泡（Split，进入 Minimal）**：
1. 整体 Island 形状短暂膨胀
2. 右侧部分"撕裂"分离，形成第二个气泡
3. 第二个气泡向右侧移动并变小至圆形
4. 整体像液体分裂，用 metaball 效果（两个形状靠近时互相吸引粘连）

**双气泡 → 单气泡（Merge，合并）**：
1. 小圆圈向 Island 主体靠近
2. 距离足够近时发生 metaball 融合（表面张力式吸附）
3. 两者合并成完整胶囊

### 活动结束动画
- 活动内容先淡出（fade out with blur）
- Island 收缩回 pill 形状
- 短暂静止后完全融入黑色边框
- 整个过程 ≈ 0.3s

### 内容更新动画（Live Activity 数据变化）
- 数字变化：向上/向下计数动画（count up/down）
- 文字替换：blur 交叉淡入淡出
- 图形元素：淡入+位移组合
- 列表行：单行滑动，其他行 fade（禁止多行同时动）

---

## 各类 Live Activity 视觉表现

### Apple Music / Spotify

**Compact 态**：
- Leading：专辑封面小圆缩略图（约 24×24pt，圆角 50%）
- Trailing：音频波形动画（3-4 条竖线，跳动动画）或当前进度点

**Expanded 态**：
- Leading 大区：专辑封面（约 52×52pt，圆角 8-10pt）
- Center/Bottom：歌曲名（白色粗体，15-16pt）+ 艺术家名（灰色，13pt）
- Trailing：上一首 / 暂停(播放) / 下一首 三个按钮（白色 SF Symbol，22pt）
- 底部可选：播放进度条（细线，白色/灰色）
- 右上角：AirPlay 投屏按钮

### 电话（来电 / 通话中）

**来电 Compact 态**：
- Leading：绿色圆形波动指示（表示有声音/振铃）
- Trailing：绿色接听按钮（圆形，SF Symbol phone.fill）

**来电 Expanded 态**：
- Leading 大区：来电者头像（圆形，52pt）
- Center：来电者姓名（白色，17pt bold）+ "iPhone" 副标题
- Trailing：红色挂断按钮（圆形填充）+ 绿色接听按钮（圆形填充）

**通话中 Compact 态**：
- Leading：绿色电话波形（通话时长动态更新）
- Trailing：通话时长数字（白色，monospace）

**通话中 Expanded 态**：
- 静音、扬声器、添加通话、FaceTime、键盘等快捷按钮
- 顶部：通话时长

### 导航（Apple Maps / Waze）

**Compact 态**：
- Leading：转向箭头（蓝色，SF Symbol）
- Trailing：距离数字 + 单位（"500m" / "0.3mi"）

**Expanded 态**：
- Leading 大区：大号转向箭头（蓝色，高对比）
- Center：街道名（白色 bold）+ 下一步距离
- Bottom：预计到达时间（ETA）+ 总剩余距离
- 可包含路线概览小地图（某些 App 实现）

### 计时器（Clock App Timer）

**Compact 态**：
- Leading：计时器图标（时钟 SF Symbol，橙色）
- Trailing：倒计时时间（"01:47"，monospace，白色）

**Expanded 态**：
- Center：大号倒计时数字（约 32pt，monospace，白色）
- 圆形进度环（围绕整体或居中）
- Bottom：暂停 / 取消 按钮

### 外卖配送（DoorDash / Uber Eats）

**Compact 态**：
- Leading：应用图标或配送状态图标（摩托车/餐厅）
- Trailing：预计到达时间（"12 min"）

**Expanded 态**：
- 配送状态时间线（准备中 → 取餐中 → 配送中）
- 配送员头像 + 名字
- 实时预计时间 + 地图预览（某些实现）

### 录音（Voice Memos）

**Compact 态**：
- Leading：红色实心圆（录音状态指示）
- Trailing：录音时长（动态更新，"00:32"）

**Expanded 态**：
- Center：实时波形可视化（音频振幅曲线，白色/红色）
- 录音时长（大号显示）
- 底部：暂停 / 停止按钮

### AirDrop

**Compact 态**：
- Leading：AirDrop 图标
- Trailing：传输进度百分比或文件名截断

**Expanded 态**：
- 发送方头像 + 文件图标
- 水平进度条
- 文件名 + 文件大小

### 体育比赛直播（Sports Live Score）

**Compact 态**：
- Leading：主队队徽（小图标）
- Trailing：比分（"3 - 1"，monospace）+ 比赛时间

**Expanded 态**：
- 两队队徽（居中排列，大号）
- 中间：比分（粗体大号）
- 比赛状态（第几节/上半场等）
- 最近得分事件

---

## 交互设计规范

### 点击行为
- **单击 Compact 态**：直接跳转打开对应 App（不展开）
- **单击 Expanded 态**：跳转打开对应 App（expanded 消失）
- **点击 Leading / Trailing**：均跳转同一 App 场景

### 长按行为
- **长按 Compact 态**：触发展开到 Expanded 态（最重要手势）
- 长按触发阈值：约 0.5s
- 松开后 Expanded 维持显示，不立即收起

### 收起行为
- 点击 Expanded 外部区域：收起回 Compact
- 上滑手势：收起
- 等待约 3-4 秒无操作：自动收起

### Swipe 行为
- 向左/右滑动 Island：dismiss 当前显示的活动内容（活动仍在后台运行）
- 双活动时向左/右滑动：切换显示哪个活动

### 系统级提醒展开
- 来电、AirDrop 等系统事件：自动展开到 Expanded，无需用户手势

---

## 设计原则

### 信息层级判断（什么值得在 Compact 显示）

**规则**：Compact 只放"最高优先级的一个数字/状态"

- 音乐：当前播放状态（波形动画）+ 封面
- 导航：下一步距离（最紧急的信息）
- 计时：剩余时间
- 来电：来电提示 + 快速接/挂
- 外卖：到达时间

**反面案例**：显示完整文字、多行信息、复杂图表——这些属于 Expanded

### 注意力管理

- Island 动画不应打断用户正在进行的操作
- 自动展开仅限高优先级系统事件（来电、AirDrop）
- 第三方 App 不应随意触发自动展开
- Live Activity 更新频率限制：最少 30 秒间隔（系统限制）
- 数据更新要有动画，但动画不能喧宾夺主（"restrained motion reads as premium"）

### 视觉语言原则

1. **同心性（Concentricity）**：内容形状必须与 Island 外框同心，边距均匀。用 blur 测试验证：模糊后形状应同心。
2. **圆润粗重**：字体用 heavy weight，形状用 extra rounded
3. **颜色大胆**：用应用品牌色建立身份，不要因深/浅色模式频繁切换颜色（破坏视觉关联）
4. **无指向性 UI**：Island 内不能有箭头指向 Island 本身
5. **内容即形状**：内容决定 Island 宽度，不留多余空白

### 优雅退场

- 活动结束时先显示完成状态（打钩、"已到达"等）
- 短暂停留（约 2-3 秒）让用户感知结果
- 然后淡出+收缩回 pill
- 系统会在活动结束后自动移除，不需要用户手动关闭

---

## 不同设备适配

| 设备 | Dynamic Island 支持 | 备注 |
|------|-------------------|------|
| iPhone 14 Pro / Pro Max | 完整支持（初代）| 原始规格 |
| iPhone 15 全系列 | 完整支持 | 扩展到非 Pro |
| iPhone 16 全系列 | 完整支持 | 新增 Action Button 集成 |
| iPhone 17 全系列 | 完整支持 | 延续 |
| MacBook Pro 2026（预期）| 适配版本 | 位于屏幕顶部中央 |

---

## 技术实现参考（SwiftUI）

```swift
// 标准 Dynamic Island 配置
struct MyActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MyActivityAttributes.self) { context in
            // Lock Screen / Notification 视图
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded 四区域
                DynamicIslandExpandedRegion(.leading) {
                    // 左侧内容（通常是大图/头像）
                }
                DynamicIslandExpandedRegion(.trailing) {
                    // 右侧内容（通常是按钮）
                }
                DynamicIslandExpandedRegion(.center) {
                    // 中心内容（主要文字信息）
                }
                DynamicIslandExpandedRegion(.bottom) {
                    // 底部内容（进度条/次要信息）
                }
            } compactLeading: {
                // Compact Leading（左侧紧凑内容）
            } compactTrailing: {
                // Compact Trailing（右侧紧凑内容）
            } minimal: {
                // Minimal（最小气泡内容）
            }
        }
    }
}

// 推荐弹簧动画
withAnimation(.spring(duration: 0.5, bounce: 0.15)) {
    // 状态切换
}
```

---

## 对 WinIsland 实现的直接启示

### 必须修正的偏差（基于此研究）

1. **圆角**：必须使用 continuous squircle，不是普通圆角矩形
2. **背景色**：必须是纯黑（#000000），要与屏幕顶部黑色边框视觉融合
3. **Spring 参数**：stiffness=400, damping=30（或等效 duration=0.5, bounce=0.12）
4. **Compact 高度**：固定 37pt 等比换算（Windows DPI 需换算为像素）
5. **内容不留余白**：内容要"snug against"，宽度由内容决定
6. **展开触发**：只能通过长按（0.5s），不是单击
7. **动画序列**：展开时形变先于内容，收起时内容先于形变

### DPI 换算参考
- iOS 1pt = iPhone 14 Pro 3x @460ppi ≈ 3 physical pixels
- Windows 高DPI (144dpi, 150%缩放)：1pt ≈ 2px
- 建议使用相对单位（vp/em）以适配不同 DPI

---

## 参考资料

- [Design dynamic Live Activities - WWDC23](https://developer.apple.com/videos/play/wwdc2023/10194/)
- [Animate with springs - WWDC23](https://developer.apple.com/videos/play/wwdc2023/10158/)
- [DynamicIsland - Apple Developer Documentation](https://developer.apple.com/documentation/widgetkit/dynamicisland)
- [Recreating the Dynamic Island - cho.sh](https://cho.sh/w/9F7F85)
- [Start Designing for Dynamic Island - Infinum](https://infinum.com/blog/start-designing-for-dynamic-island-and-live-activities/)
- [Dynamic Island Reference Dimensions - Drew Solorio on Behance](https://www.behance.net/gallery/153642485/Dynamic-Island-Reference-Dimensions)
- [Live Activity & Dynamic Island - SparrowCode](https://sparrowcode.io/en/tutorials/live-activities)
- [Apple Dynamic Island Guide - Denovers](https://www.denovers.com/blog/what-is-dynamic-island-apple-an-updated-guide-for-ios18)
- [Dynamic Island Complete Guide - MacRumors](https://www.macrumors.com/guide/dynamic-island/)
- [Mastering Dynamic Island in SwiftUI - Swift with Majid](https://swiftwithmajid.com/2022/09/28/mastering-dynamic-island-in-swiftui/)

---

## 下一步行动

- [ ] 对照此规范审计现有 WinIsland Rust 代码（Task #2）
- [ ] 设计 OmniAgent 工具在三种形态下的 Content Map（Task #3）
- [ ] 输出完整重设计方案，含每种工具的 UI 规格（Task #4）
