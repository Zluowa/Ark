"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import Link from "next/link";
import { WrenchIcon } from "lucide-react";
import { Thread } from "@/components/assistant-ui/thread";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { ThreadListSidebar } from "@/components/assistant-ui/threadlist-sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { appConfig } from "@/lib/config/app-config";
import { publicEnv } from "@/lib/config/public-env";

export const Assistant = () => {
  const chatHeaders = publicEnv.apiKey
    ? {
        "X-API-Key": publicEnv.apiKey,
      }
    : undefined;

  const runtime = useChatRuntime({
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport: new AssistantChatTransport({
      api: publicEnv.chatApiPath,
      headers: chatHeaders,
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SidebarProvider>
        <div className="flex h-dvh w-full pr-0.5">
          <ThreadListSidebar />
          <SidebarInset>
            <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
              <SidebarTrigger />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem className="hidden md:block">
                    <BreadcrumbLink
                      href={appConfig.links.docs}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {appConfig.name} Docs
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden md:block" />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{appConfig.shellTitle}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <div className="ml-auto">
                <Button variant="outline" size="sm" asChild>
                  <Link href="/dashboard/tools">
                    <WrenchIcon className="size-4" />
                    Tools
                  </Link>
                </Button>
              </div>
            </header>
            <div className="border-b bg-muted/30 px-4 py-2">
              <p className="text-[11px] text-muted-foreground">
                Fast-dispatch is enabled for one-sentence tool intents. If not
                matched, chat falls back to full assistant reasoning.
              </p>
            </div>
            <div className="flex-1 overflow-hidden">
              <Thread />
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </AssistantRuntimeProvider>
  );
};
