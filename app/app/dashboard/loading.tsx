// @input: none
// @output: dashboard route loading UI via Next.js Suspense boundary
// @position: automatic — Next.js shows this during dashboard page load

import { DashboardSkeleton } from "@/components/skeletons/dashboard-skeleton";

export default function DashboardLoading() {
  return <DashboardSkeleton />;
}
