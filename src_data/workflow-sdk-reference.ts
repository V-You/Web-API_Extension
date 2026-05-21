// GENERATED FILE - do not edit by hand.
// Source: src_data/workflow-sdk-registry.json
// Regenerate with: npm run generate:sdk-reference
// See PRD 2026-05-18 D15.

export const WORKFLOW_SDK_REFERENCE = `Authoritative workflow SDK reference (generated from src_data/workflow-sdk-registry.json).
Do not call namespaces or methods that are not listed here. If you need a capability that is missing, return a workflow draft that throws a clear error explaining the missing SDK surface instead of inventing a method.
Transaction helper params are flat objects. For card data, use top-level fields cardNumber, cardHolder, cardExpiryMonth, cardExpiryYear, and cardCvv. Do not pass a nested card object such as card: { holder: ... }.
Universal list contract: every sdk.*.list*, sdk.*.search, and sdk.entities.listChildren method returns a plain JavaScript array of row objects. Call .map / .filter / .slice / .find directly on the returned value. Do not read .data, .items, .ownedContacts, .merchantAccounts, or any other wrapper key off the return value - normalization already happened inside the SDK.
sdk.entities.listChildren(parentType, parentId, childType) returns an array. Channel rows expose a stable id field; the SDK aliases API channel rows where the entity ID is named channel.

sdk.config:
  - sdk.config.get(entityType, entityId, sdkPath)
  - sdk.config.batchGet(entityType, entityIds, paths)
  - sdk.config.describe(query, limit?)
  - sdk.config.validate(settings)
  - sdk.config.coverage()
  - sdk.config.update(entityType, entityId, settings)
  - sdk.config.batchUpdate(entityType, entityId, settings)

sdk.settings:
  - sdk.settings.get(entityType, entityId, sdkPath)
  - sdk.settings.batchGet(entityType, entityIds, paths)
  - sdk.settings.describe(query, limit?)
  - sdk.settings.validate(settings)
  - sdk.settings.coverage()
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

sdk top-level helpers:
  - sdk.describeSettings(query, limit?)
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
  "config.batchGet",
  "config.batchUpdate",
  "config.coverage",
  "config.describe",
  "config.get",
  "config.update",
  "config.validate",
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
  "describeSettings",
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
  "settings.batchGet",
  "settings.batchUpdate",
  "settings.coverage",
  "settings.describe",
  "settings.edit",
  "settings.get",
  "settings.update",
  "settings.validate",
  "transactions.sendTest",
  "transactions.sendTestBatch"
] as const;
