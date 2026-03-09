// @input: WelcomeHero, StatsRow, QuickActions, RecentActivity, ApiKeyCard components
// @output: commercial-grade Home dashboard with hero, stats, quick-access grid, activity feed
// @position: default dashboard landing page

import { WelcomeHero } from "@/components/dashboard/welcome-hero";
import { StatsRow } from "@/components/dashboard/stats-row";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { ApiKeyCard } from "@/components/dashboard/api-key-card";
import { TOOL_COUNT } from "@/lib/tools/get-tools";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-col gap-6">
        <WelcomeHero />
        <StatsRow toolCount={TOOL_COUNT} />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 flex flex-col gap-6">
            <QuickActions />
            <ApiKeyCard />
          </div>
          <div>
            <RecentActivity />
          </div>
        </div>
      </div>
    </div>
  );
}
