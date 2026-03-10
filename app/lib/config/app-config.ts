const githubUrl =
  process.env.NEXT_PUBLIC_OMNIAGENT_GITHUB_URL?.trim() ||
  "https://github.com/Zluowa/Ark";

export const appConfig = {
  name: "Ark",
  shortName: "Ark",
  shellTitle: "Operator Workspace",
  description:
    "一句话就完事。 Island and Web for users, API for agents, all powered by Ark's shared execution layer.",
  links: {
    docs: "/open-source",
    developers: "/developers",
    source: githubUrl,
  },
} as const;
