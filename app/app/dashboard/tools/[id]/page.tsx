// @input: Dynamic [id] param matching tool manifest ID (e.g. "generate.kanban")
// @output: Full-page standalone tool experience
// @position: /dashboard/tools/[id] route — Server Component

import { notFound } from "next/navigation";
import { getToolManifests } from "@/lib/tools/get-tools";
import { ToolStandalone } from "@/components/tools/tool-standalone";

export default async function ToolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tool = getToolManifests().find((m) => m.id === id);
  if (!tool) notFound();
  return <ToolStandalone tool={tool} />;
}
