# n8n-nodes-m7-form-login

Mount7 n8n community node package for **secret-safe supplier logins**. Username
and password live in an encrypted n8n credential; the nodes perform the login
internally and output **only the resulting auth cookie / session** — credentials
never appear in node output, execution data, or backups.

Built to replace the old "echo bridge" hack (Basic-Auth credential decoded back
to plaintext via an echo webhook), which leaked the password into the workflow
data stream.

## Credential

**M7 Form Login API** (`m7FormLoginApi`) — just `username` + `password`. Reused by
all nodes in this package. Stored encrypted via `N8N_ENCRYPTION_KEY`.

## Nodes

### M7 Form Login (`m7FormLogin`)
Generic `application/x-www-form-urlencoded` login. Optional GET to harvest cookies
+ a CSRF token, then a configurable form POST. Outputs `{ headers: { Cookie } }`
ready to drop into an HTTP Request node. Used for JobRad Fachhandel.

### M7 Orbea Kide Login (`m7OrbeaKideLogin`)
Login for Laravel **Livewire** sites (Orbea "kide"). Extracts the CSRF meta token
+ the Livewire component snapshot, then POSTs the Livewire `/update` call.

## Build & install

```bash
npm install
npm run build      # → dist/ (committed, so git installs need no build step)
```

Install into n8n by adding a `file:` or `git+ssh` dependency in the custom-extensions
`package.json` (`~/.n8n/custom`), then restart n8n. Nodes load with the `CUSTOM.`
type prefix (`CUSTOM.m7FormLogin`, `CUSTOM.m7OrbeaKideLogin`).
