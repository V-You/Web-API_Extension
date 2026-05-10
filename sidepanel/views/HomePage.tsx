import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { useCredentialStore } from "../../src/hooks/useCredentialStore";
import { useConnectionStatus } from "../hooks/useConnectionStatus";

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

export const TOOL_CATEGORIES: ToolCategory[] = [
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
      { name: "attach_contact", hint: "attach an existing contact to an entity" },
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
    ],
  },
  {
    label: "API tokens and test transactions",
    description: "Create short-lived transaction tokens and send UAT test payments",
    handwritten: [
      { name: "send_test_transaction", hint: "create/use/cleanup a temporary token or use a stored token" },
    ],
    generated: [
      { name: "list_api_tokens", hint: "list token metadata for a merchant" },
      { name: "get_api_token", hint: "read token metadata by ID" },
      { name: "create_api_token", hint: "create a merchant API token" },
      { name: "update_api_token", hint: "update a token alias" },
      { name: "suspend_api_token", hint: "suspend a token" },
      { name: "activate_api_token", hint: "reactivate a suspended token" },
      { name: "delete_api_token", hint: "delete a suspended token" },
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
      { name: "get_job_status", hint: "poll a background workflow Job" },
      { name: "describe_operation", hint: "inspect a tool's spec before calling it" },
    ],
    generated: [],
  },
];

export const totalToolCount = TOOL_CATEGORIES.reduce((n, c) => n + c.handwritten.length + c.generated.length, 0);
export const futureWebMcpToolCount = TOOL_CATEGORIES.reduce((n, c) => n + c.handwritten.length, 0);

export function HomePage() {
  const { isUnlocked } = useCredentialStore();
  const { status: connStatus, message: connMessage, retry } = useConnectionStatus();

  if (!isUnlocked) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p>Add API credentials in <strong>Connections</strong>.</p>
      </div>
    );
  }

  const isChecking = connStatus === "checking";

  return (
    <div className="space-y-4">

      {/* Connection status */}
      <div className="flex items-center gap-2 text-xs">
        {isChecking ? (
          <Loader2 className="w-3 h-3 text-slate-400 animate-spin" aria-hidden="true" />
        ) : (
          <span
            className={`inline-block w-3 h-3 rounded-full ${
              connStatus === "ok"
                ? "bg-emerald-500"
                : connStatus === "fail"
                  ? "bg-red-500"
                  : "bg-slate-300"
            }`}
          />
        )}
        <span className="flex-1 text-slate-500">{connMessage}</span>
        {connStatus === "fail" && (
          <button
            onClick={retry}
            aria-label="Retry connection check"
            title="Retry connection check"
            className="text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded p-0.5"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
          </button>
        )}
      </div>

      <p className="text-2xs text-slate-400 mt-1">
        {totalToolCount} tools available (needed for WebMCP: {futureWebMcpToolCount}). Click a category to see details.
      </p>

      <div className="grid gap-2">
        {TOOL_CATEGORIES.map((cat) => (
          <ToolCategoryCard key={cat.label} category={cat} />
        ))}
      </div>

      {/* Build info */}
      <p className="text-slate-400 text-2xs mt-6 text-center">
        Version {__APP_VERSION__} &middot; Built {__BUILD_TIMESTAMP__}
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
        <span className="flex items-center gap-1 text-slate-400 text-xs shrink-0 ml-2">
          {total}
          {open ? (
            <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-100 space-y-2">
          {category.handwritten.length > 0 && (
            <div>
              <p className="text-2xs uppercase tracking-wide text-slate-400 mb-1">
                Umbrella tools
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
              <p className="text-2xs uppercase tracking-wide text-slate-400 mb-1">
                Per-action tools <span className="normal-case">(generated from API spec)</span>
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
      <code className="text-2xs text-blue-600 shrink-0">{tool.name}</code>
      <span className="text-slate-400">&ndash;</span>
      <span className="text-slate-500">{tool.hint}</span>
    </li>
  );
}
