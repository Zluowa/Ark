// @input: none
// @output: tools route loading UI via Next.js Suspense boundary
// @position: automatic — Next.js shows this during /dashboard/tools page load

import { ToolsSkeleton } from "@/components/skeletons/tools-skeleton";

export default function ToolsLoading() {
  return <ToolsSkeleton />;
}
