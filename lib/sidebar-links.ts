export type SidebarLink = {
  name: string;
  label: string;
  url: string;
};

export const isHttpUrl = (value: string) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};

export const getSidebarLinks = (value: unknown): SidebarLink[] => {
  if (!Array.isArray(value)) return [];

  const names = new Set<string>();

  return value.filter((link): link is SidebarLink => {
    const isValid =
      link != null &&
      typeof link === "object" &&
      typeof link.name === "string" &&
      /^[a-zA-Z0-9-_]+$/.test(link.name) &&
      typeof link.label === "string" &&
      typeof link.url === "string" &&
      isHttpUrl(link.url) &&
      !names.has(link.name);

    if (isValid) names.add(link.name);
    return isValid;
  });
};
