// GENERATED FILE - do not edit by hand.
// Source: src/sandbox/sdk-facade.ts
// Regenerate with: npm run generate:sdk-reference
// See PRD 2026-05-18 D15.

export const WORKFLOW_SDK_REFERENCE = `Authoritative workflow SDK reference (generated from src/sandbox/sdk-facade.ts).
Do not call namespaces or methods that are not listed here. If you need a capability that is missing, return a workflow draft that throws a clear error explaining the missing SDK surface instead of inventing a method.
Transaction helper params are flat objects. For card data, use top-level fields cardNumber, cardHolder, cardExpiryMonth, cardExpiryYear, and cardCvv. Do not pass a nested card object such as card: { holder: ... }.
sdk.entities.listChildren(parentType, parentId, childType) returns an array, so array methods such as map/filter/slice are valid. Channel rows expose a stable id field; the SDK aliases API channel rows where the entity ID is named channel.

sdk.config:
  - sdk.config.update(entityType, entityId, settings)
  - sdk.config.batchUpdate(entityType, entityId, settings)

sdk.settings:
  - sdk.settings.edit(entityType, entityId, settings)
  - sdk.settings.update(entityType, entityId, settings)
  - sdk.settings.batchEdit(entityType, entityId, settings)
  - sdk.settings.batchUpdate(entityType, entityId, settings)

sdk.entities:
  - sdk.entities.get(entityType, entityId)
  - sdk.entities.search(namePath)
  - sdk.entities.listChildren(parentType, parentId, childType)
  - sdk.entities.create(parentType, parentId, childType, fields)
  - sdk.entities.edit(entityType, entityId, fields)
  - sdk.entities.delete(entityType, entityId)

sdk.hierarchy:
  - sdk.hierarchy.fetch(pspId, depth?)
  - sdk.hierarchy.estimate(pspId, depth?)

sdk.contacts:
  - sdk.contacts.get(contactId)
  - sdk.contacts.list(entityType, entityId, scope?)
  - sdk.contacts.create(entityType, entityId, fields)
  - sdk.contacts.edit(contactId, fields)
  - sdk.contacts.delete(contactId)
  - sdk.contacts.attach(entityType, entityId, contactId)
  - sdk.contacts.detach(entityType, entityId, contactId)
  - sdk.contacts.lock(contactId)
  - sdk.contacts.unlock(contactId)
  - sdk.contacts.resetPassword(contactId, _newPassword?)

sdk.merchantAccounts:
  - sdk.merchantAccounts.get(merchantAccountId)
  - sdk.merchantAccounts.list(entityType, entityId, scope?)
  - sdk.merchantAccounts.create(...args)  // overloaded; see behavioural rules above for accepted shapes
  - sdk.merchantAccounts.edit(...args)  // overloaded; see behavioural rules above for accepted shapes
  - sdk.merchantAccounts.update(...args)  // overloaded; see behavioural rules above for accepted shapes
  - sdk.merchantAccounts.activate(...args)  // overloaded; see behavioural rules above for accepted shapes
  - sdk.merchantAccounts.delete(merchantAccountId)
  - sdk.merchantAccounts.attach(...args)  // overloaded; see behavioural rules above for accepted shapes
  - sdk.merchantAccounts.detach(attachedMerchantAccountId)
  - sdk.merchantAccounts.threeDCheck(merchantAccountId)

sdk.clearingInstitutes:
  - sdk.clearingInstitutes.search(query)
  - sdk.clearingInstitutes.getFields(ciCode)
  - sdk.clearingInstitutes.listLive(pspId)

sdk.cardProcessors:
  - sdk.cardProcessors.list(pspId?)
  - sdk.cardProcessors.listLive(pspId?)
  - sdk.cardProcessors.search(query)
  - sdk.cardProcessors.getFields(ciCode)

sdk.audit:
  - sdk.audit.get(opts?)

sdk.transactions:
  - sdk.transactions.sendTest(params)
  - sdk.transactions.sendTestBatch(params)
`;

export const WORKFLOW_SDK_REFERENCE_METHODS = [
  "audit.get",
  "cardProcessors.getFields",
  "cardProcessors.list",
  "cardProcessors.listLive",
  "cardProcessors.search",
  "clearingInstitutes.getFields",
  "clearingInstitutes.listLive",
  "clearingInstitutes.search",
  "config.batchUpdate",
  "config.update",
  "contacts.attach",
  "contacts.create",
  "contacts.delete",
  "contacts.detach",
  "contacts.edit",
  "contacts.get",
  "contacts.list",
  "contacts.lock",
  "contacts.resetPassword",
  "contacts.unlock",
  "entities.create",
  "entities.delete",
  "entities.edit",
  "entities.get",
  "entities.listChildren",
  "entities.search",
  "hierarchy.estimate",
  "hierarchy.fetch",
  "merchantAccounts.activate",
  "merchantAccounts.attach",
  "merchantAccounts.create",
  "merchantAccounts.delete",
  "merchantAccounts.detach",
  "merchantAccounts.edit",
  "merchantAccounts.get",
  "merchantAccounts.list",
  "merchantAccounts.threeDCheck",
  "merchantAccounts.update",
  "settings.batchEdit",
  "settings.batchUpdate",
  "settings.edit",
  "settings.update",
  "transactions.sendTest",
  "transactions.sendTestBatch"
] as const;
