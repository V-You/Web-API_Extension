interface ToolEventLike {
  name: string;
  result: unknown;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function summarizeToolResources(toolEvents: ToolEventLike[]): string[] {
  const resources = new Set<string>();

  for (const event of toolEvents) {
    const result = asObject(event.result);

    switch (event.name) {
      case "describe_settings": {
        resources.add("RiRo settings index");

        const glossary = asObject(result?.glossary);
        if (glossary?.applied === true) {
          resources.add("Glossary");
        }

        const familyResolution = asObject(result?.familyResolution);
        if (familyResolution?.applied === true) {
          resources.add("Setting family map");
        }
        break;
      }
      case "describe_operation":
        resources.add("Operation manifest");
        break;
      case "manage_settings":
        resources.add("Settings API");
        break;
      case "manage_contact":
        resources.add("Contacts API");
        break;
      case "manage_entity":
      case "get_hierarchy":
        resources.add("Hierarchy API");
        break;
      case "manage_merchant_account":
        resources.add("Merchant accounts API");
        break;
      case "lookup_clearing_institutes":
        resources.add("Clearing institute lookup");
        break;
      default:
        break;
    }
  }

  return [...resources];
}