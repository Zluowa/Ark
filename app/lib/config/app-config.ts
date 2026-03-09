const githubUrl =
  process.env.NEXT_PUBLIC_OMNIAGENT_GITHUB_URL?.trim() ||
  "https://github.com/Zluowa/Ark";

export const appConfig = {
  name: "Ark",
  shortName: "Ark",
  shellTitle: "Operator Workspace",
  description:
    "The Dynamic Island, made useful: open-source orchestration for island-native workflows, with a self-hosted dashboard, native capture surfaces, and BYOK providers.",
  links: {
    docs: "/open-source",
    source: githubUrl,
  },
} as const;
