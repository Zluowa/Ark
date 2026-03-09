const githubUrl =
  process.env.NEXT_PUBLIC_OMNIAGENT_GITHUB_URL?.trim() ||
  "https://github.com/Zluowa/Ark";

export const appConfig = {
  name: "Ark",
  shortName: "Ark",
  shellTitle: "Operator Workspace",
  description:
    "Open-source Dynamic Island tooling with a self-hosted dashboard, capture workflows, and bring-your-own-keys providers.",
  links: {
    docs: "/open-source",
    source: githubUrl,
  },
} as const;
