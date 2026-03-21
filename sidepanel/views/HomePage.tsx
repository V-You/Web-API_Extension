import { useCredentialStore } from "../../src/hooks/useCredentialStore";

export function HomePage() {
  const { isUnlocked, activeEnv } = useCredentialStore();

  if (!isUnlocked) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p className="text-lg font-medium mb-2">Welcome</p>
        <p>
          Go to <strong>Connections</strong> to add your API credentials and get
          started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">
        Dashboard &ndash; {activeEnv?.toUpperCase()}
      </h2>
      <p className="text-slate-500 text-xs">
        Use the sidebar tools to manage entities, settings, and contacts.
      </p>

      <div className="grid gap-3">
        <QuickAction
          label="Manage entities"
          description="List, create, or edit entities in the hierarchy"
        />
        <QuickAction
          label="View settings"
          description="Read or write settings at any hierarchy level"
        />
        <QuickAction
          label="Manage contacts"
          description="Create, edit, or lock/unlock contact users"
        />
      </div>
    </div>
  );
}

function QuickAction({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <button className="text-left w-full border border-slate-200 rounded-lg p-3 hover:bg-slate-50 transition-colors">
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-xs text-slate-500 mt-0.5">
        {description}
      </span>
    </button>
  );
}
