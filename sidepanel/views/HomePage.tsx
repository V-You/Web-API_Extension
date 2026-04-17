import { useState, useEffect } from "react";
import { useCredentialStore } from "../../src/hooks/useCredentialStore";
import { getCredentials } from "../../src/lib/storage";
import { buildConnectionProbeUrl, classifyConnectionProbeResponse } from "../../src/lib/connection-probe";

// -- Tool catalog for the expandable cards --------------------------------

interface ToolEntry {
  name: string;
  hint: string;
}

interface ToolCategory {
  label: string;
  description: string;
  handwritten: ToolEntry[];
  generated: ToolEntry[];
}

const TOOL_CATEGORIES: ToolCategory[] = [
  {
    label: "Entities",
    description: "Navigate and manage the payment hierarchy (PSP, division, merchant, channel)",
    handwritten: [
      { name: "manage_entity", hint: "read entities -- get, search, list children" },
      { name: "get_hierarchy", hint: "fetch the full entity tree from any root" },
    ],
    generated: [
      { name: "get_entity", hint: "read a single entity" },
      { name: "create_division", hint: "create a division under a PSP" },
      { name: "create_merchant", hint: "create a merchant under a division" },
      { name: "create_channel", hint: "create a channel under a merchant" },
      { name: "edit_entity", hint: "update entity fields" },
      { name: "delete_entity", hint: "delete an entity" },
      { name: "list_divisions", hint: "list divisions under a PSP" },
      { name: "list_merchants", hint: "list merchants under a division" },
      { name: "list_channels", hint: "list channels under a merchant" },
    ],
  },
  {
    label: "Contacts",
    description: "Create, edit, or lock/unlock contact users on entities",
    handwritten: [
      { name: "manage_contact", hint: "read contacts -- get, list, find by username" },
    ],
    generated: [
      { name: "get_contact", hint: "read a single contact" },
      { name: "create_contact", hint: "create a new contact" },
      { name: "edit_contact", hint: "update contact fields" },
      { name: "delete_contact", hint: "delete a contact" },
      { name: "detach_contact", hint: "detach a contact from an entity" },
      { name: "lock_contact", hint: "lock a contact account" },
      { name: "unlock_contact", hint: "unlock a contact account" },
      { name: "set_contact_password", hint: "reset a contact's password" },
      { name: "list_owned_contacts", hint: "list contacts owned by an entity" },
      { name: "list_attached_contacts", hint: "list contacts attached to an entity" },
    ],
  },
  {
    label: "Merchant accounts",
    description: "Manage merchant accounts and clearing institute mappings",
    handwritten: [
      { name: "manage_merchant_account", hint: "read MAs -- get, list" },
      { name: "lookup_clearing_institutes", hint: "search CIs, get required fields, list live CIs" },
    ],
    generated: [
      { name: "get_merchant_account", hint: "read a single MA" },
      { name: "create_merchant_account", hint: "create a new MA" },
      { name: "edit_merchant_account", hint: "update MA fields (incl. 3DS)" },
      { name: "delete_merchant_account", hint: "delete an MA" },
      { name: "attach_merchant_account", hint: "attach an MA to an entity" },
      { name: "detach_merchant_account", hint: "detach an MA from an entity" },
      { name: "list_owned_merchant_accounts", hint: "list MAs owned by an entity" },
      { name: "list_attached_merchant_accounts", hint: "list MAs attached to an entity" },
      { name: "list_clearing_institutes", hint: "list CIs available at a PSP" },
    ],
  },
  {
    label: "Settings",
    description: "Read or write RiRo settings at any hierarchy level",
    handwritten: [
      { name: "describe_settings", hint: "search settings by keyword -- returns type info" },
      { name: "manage_settings", hint: "get, set, batch read/write, list non-default values" },
    ],
    generated: [],
  },
  {
    label: "Automation and reference",
    description: "Audit log, scripting, and operation introspection",
    handwritten: [
      { name: "get_audit_log", hint: "query the local audit log with filters" },
      { name: "execute_workflow", hint: "run TypeScript in a sandbox with the virtual SDK" },
      { name: "describe_operation", hint: "inspect a tool's spec before calling it" },
    ],
    generated: [],
  },
];

export function HomePage() {
  const { isUnlocked, activeEnv }     = useCredentialStore();
  const [connStatus, setConnStatus]   = useState<"checking" | "ok" | "fail" | null>(null);
  const [connMessage, setConnMessage] = useState("Not connected");

  // Check connection status when unlocked
  useEffect(() => {
    if (!isUnlocked || !activeEnv) {
      setConnStatus(null);
      setConnMessage("Not connected");
      return;
    }
    setConnStatus("checking");
    setConnMessage("Checking connection...");
    getCredentials(activeEnv).then((creds) => {
      const url = creds ? buildConnectionProbeUrl(creds) : null;
      const scopeLabel = creds?.scopeEntityId
        ? `${creds.scopeEntityType ?? "psp"} ${creds.scopeEntityId}`
        : creds?.pspId
          ? `psp ${creds.pspId}`
          : "saved scope";

      if (!creds || !url) {
        setConnStatus("fail");
        setConnMessage("Connection not configured -- add credentials and entity scope in Connections.");
        return;
      }

      fetch(url, {
        method: "GET",
        headers: { credentials: `${creds.username}:${creds.password}` },
      })
        .then(async (res) => {
          const result = await classifyConnectionProbeResponse(res);
          setConnStatus(result.ok ? "ok" : "fail");
          setConnMessage(
            result.ok
              ? `Connected to Web API (${activeEnv.toUpperCase()}, ${scopeLabel})`
              : `${activeEnv.toUpperCase()} Web API check failed for ${scopeLabel}: ${result.message}`,
          );
        })
        .catch((err) => {
          setConnStatus("fail");
          setConnMessage(err instanceof Error ? err.message : "Connection failed.");
        });
    });
  }, [isUnlocked, activeEnv]);

  if (!isUnlocked) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p>Add API credentials in <strong>Connections</strong>.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Connection status */}
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`inline-block w-3 h-3 rounded-full ${
            connStatus === "ok"
              ? "bg-green-500"
              : connStatus === "fail"
                ? "bg-red-500"
                : "bg-slate-300 animate-pulse"
          }`}
        />
        <span className="text-slate-500">
          {connMessage}
        </span>
      </div>

      <p className="text-[11px] text-slate-400 mt-1">
        {TOOL_CATEGORIES.reduce((n, c) => n + c.handwritten.length + c.generated.length, 0)} tools
        available. Click a category to see details.
      </p>

      <div className="grid gap-2">
        {TOOL_CATEGORIES.map((cat) => (
          <ToolCategoryCard key={cat.label} category={cat} />
        ))}
      </div>

      {/* Build info */}
      <p className="text-slate-400 text-[10px] mt-6 text-center">
        Built {__BUILD_TIMESTAMP__}
      </p>
    </div>
  );
}

function ToolCategoryCard({ category }: { category: ToolCategory }) {
  const [open, setOpen] = useState(false);
  const total = category.handwritten.length + category.generated.length;

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="text-left w-full p-3 hover:bg-slate-50 transition-colors flex items-center justify-between"
      >
        <div>
          <span className="block text-sm font-medium">{category.label}</span>
          <span className="block text-xs text-slate-500 mt-0.5">{category.description}</span>
        </div>
        <span className="text-slate-400 text-xs shrink-0 ml-2">
          {total} {open ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-100 space-y-2">
          {category.handwritten.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                Multi-Tools
              </p>
              <ul className="space-y-0.5">
                {category.handwritten.map((t) => (
                  <ToolRow key={t.name} tool={t} />
                ))}
              </ul>
            </div>
          )}
          {category.generated.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">
                Action-Tools <span className="normal-case">(generated from API spec)</span>
              </p>
              <ul className="space-y-0.5">
                {category.generated.map((t) => (
                  <ToolRow key={t.name} tool={t} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolEntry }) {
  return (
    <li className="flex items-baseline gap-1.5 text-xs">
      <code className="text-[11px] text-blue-600 shrink-0">{tool.name}</code>
      <span className="text-slate-400">&ndash;</span>
      <span className="text-slate-500">{tool.hint}</span>
    </li>
  );
}
