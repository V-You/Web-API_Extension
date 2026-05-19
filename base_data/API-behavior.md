# API behavior or quirks

- **Eventual consistency.** After creating or updating entities, changes may take up to 3 minutes to propagate through the API cache.
- Rate limiting: 10 requests / second. Default setting in Extension UI: 9.
- Form-encoded data (NOT JSON)
- "Error tunneling" via HTTP 200 status: API error format: 200.300.404 (for "not found"), plus additional API erro code with details in response body.
- Typos in setting names or call paths or UI paths: (add here)
- **PSP entity level has no GET endpoint.** It is only a parent for sub-resources.
- **`list_channels` shape.** Returns channel logins -- the `channel` field is the entity ID, not `id`.
- **POST, not PUT.** All updates use POST. The API does not support PUT.
- **Custom credentials header.** `credentials: username:password` (raw, not base64, not standard Basic Auth).
- **GET /setting limited.** Only works at merchant and channel level. POST /setting works at all levels (PSP, division, merchant, channel). Settings are inherited, so an empty value means "not set here" rather than "off". The extension resolves effective values upward where the API permits it, e.g. channel -> merchant. If the chain reaches division or PSP, the effective value is unknown through the API; the result includes the known default and the agent can use context binding to inspect the dashboard manually when the user needs the true operational value.
- Transactions are always sent to Channel entity level. Merchant Accounts need to be **attached** to Channel level. They can be **available** at any entity above.
- When feature "Channel Dispatching" is used, transactions might target a Merchant entity, and are then dispatched to Channels under that Merchant.
- **Merchant Account clearing institute identifier.** `clearingInstituteId` must be the 32-character API UUID. CI codes or labels such as `ACCEPTANCE` belong in `clearingInstituteName` unless a live PSP-scoped lookup has returned the UUID.
- Each Available Merchant Account has fields. There are a number of fixed fields that are always named the same, like: merchantId, merchantName, terminalId, key, username, password. In the UI, the name of these fields can be completely different, requiring a mapping. On top of that, if a Merchant Account has more input fields than those standard ones, the names are arbitrary. On top of the needed mapping that needs to exist for each Merchant Account that is created from a Clearing Institute, there can be confusion, example: A transaction may fail with reason "merchantAccount.merchantName" missing, where merchantName refers to the MA field and not to the 3DS block that also has a merchant name.