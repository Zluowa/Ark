// @input: target position, stiffness/damping params per frame
// @output: smoothly animated f32 value with settled detection
// @position: core spring engine for island geometry/content animation

/// Apple-style spring presets (stiffness, damping).
/// Values are tuned for quick response with minimal overshoot.
#[allow(dead_code)]
pub const SPRING_MAIN: (f32, f32) = (0.12, 0.65); // Main shell (w/h)
#[allow(dead_code)]
pub const SPRING_RADIUS: (f32, f32) = (0.15, 0.60); // Corner radius
#[allow(dead_code)]
pub const SPRING_CONTENT: (f32, f32) = (0.20, 0.55); // Content fade/scale
#[allow(dead_code)]
pub const SPRING_SPLIT: (f32, f32) = (0.10, 0.70); // Stack handoff
#[allow(dead_code)]
pub const SPRING_BOUNCE: (f32, f32) = (0.18, 0.68); // Hover/press micro-bounce

pub struct Spring {
    pub value: f32,
    pub velocity: f32,
    pub settled: bool,
}

impl Spring {
    pub fn new(value: f32) -> Self {
        Self {
            value,
            velocity: 0.0,
            settled: true,
        }
    }

    /// Apple-style spring: fast response + small overshoot.
    pub fn update(&mut self, target: f32, stiffness: f32, damping: f32) {
        let force = (target - self.value) * stiffness;
        self.velocity = (self.velocity + force) * damping;
        self.value += self.velocity;

        // Critical-damping style settle snap to avoid long micro-oscillation.
        if (self.value - target).abs() < 0.5 && self.velocity.abs() < 0.1 {
            self.value = target;
            self.velocity = 0.0;
            self.settled = true;
        } else {
            self.settled = false;
        }
    }

    #[allow(dead_code)]
    pub fn is_animating(&self) -> bool {
        !self.settled
    }

    /// Snap to target immediately (used for initialization).
    #[allow(dead_code)]
    pub fn snap(&mut self, target: f32) {
        self.value = target;
        self.velocity = 0.0;
        self.settled = true;
    }
}
