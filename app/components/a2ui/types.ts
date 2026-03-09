// @input: Widget metadata definitions
// @output: Type contracts for the A2UI widget protocol
// @position: Type foundation for all widgets

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import type { LucideIcon } from "lucide-react";

export type PillMeta = {
  icon: LucideIcon;
  label: string;
  accent: string;
  bgAccent: string;
  summary?: (result: unknown) => string;
};

export type WidgetEntry = {
  component: ToolCallMessagePartComponent;
  pill: PillMeta;
};
