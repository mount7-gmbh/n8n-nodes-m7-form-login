"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.M7OrbeaKideLogin = void 0;
const n8n_workflow_1 = require("n8n-workflow");
class M7OrbeaKideLogin {
    constructor() {
        this.description = {
            displayName: 'M7 Orbea Kide Login',
            name: 'm7OrbeaKideLogin',
            icon: 'file:m7-form-login.svg',
            group: ['transform'],
            version: 1.0,
            description: 'Prepares an authenticated session in the in-house TLS-impersonation proxy and returns its id. Secrets stay in the credential.',
            defaults: {
                name: 'Orbea Login',
            },
            inputs: ['main'],
            outputs: ['main'],
            credentials: [
                {
                    name: 'm7FormLoginApi',
                    required: true,
                },
            ],
            properties: [
                {
                    displayName: 'TLS-Impersonate Proxy URL',
                    name: 'proxyUrl',
                    type: 'string',
                    default: 'http://tls-impersonate:8000',
                    required: true,
                    description: 'Base URL of the in-house TLS-impersonation proxy.',
                },
                {
                    displayName: 'Site Base URL',
                    name: 'baseUrl',
                    type: 'string',
                    default: 'https://www.orbea.com',
                    required: true,
                    description: 'Base URL of the target site; the proxy session is bound to it.',
                },
                {
                    displayName: 'Login Page Path (GET)',
                    name: 'loginPath',
                    type: 'string',
                    default: '/de-de/kide/anmeldung',
                    required: true,
                },
                {
                    displayName: 'Livewire Update Path (POST)',
                    name: 'updatePath',
                    type: 'string',
                    default: '/livewire/update',
                    required: true,
                },
                {
                    displayName: 'Livewire Component Name',
                    name: 'componentName',
                    type: 'string',
                    default: 'kide.authentication::login',
                    description: 'memo.name of the login component to pick from the page snapshots',
                },
                {
                    displayName: 'CSRF Meta Regex',
                    name: 'csrfMetaRegex',
                    type: 'string',
                    default: '<meta[^>]+name=["\']csrf[-_]token["\'][^>]+content=["\']([^"\']+)["\']',
                    description: 'Regex with one capture group for the CSRF token in a <meta> tag',
                },
                {
                    displayName: 'Username Update Field',
                    name: 'usernameField',
                    type: 'string',
                    default: 'username',
                },
                {
                    displayName: 'Password Update Field',
                    name: 'passwordField',
                    type: 'string',
                    default: 'password',
                },
                {
                    displayName: 'Impersonate Profile',
                    name: 'impersonate',
                    type: 'string',
                    default: 'chrome',
                    description: 'curl_cffi impersonation profile (e.g. chrome, chrome131, safari)',
                },
            ],
        };
    }
    async execute() {
        var _a, _b;
        const htmlDecode = (s) => s
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
        const items = this.getInputData();
        const returnData = [];
        const credentials = await this.getCredentials('m7FormLoginApi');
        const username = credentials.username;
        const password = credentials.password;
        for (let i = 0; i < items.length; i++) {
            try {
                const proxyUrl = this.getNodeParameter('proxyUrl', i).replace(/\/+$/, '');
                const baseUrl = this.getNodeParameter('baseUrl', i).replace(/\/+$/, '');
                const loginPath = this.getNodeParameter('loginPath', i);
                const updatePath = this.getNodeParameter('updatePath', i);
                const componentName = this.getNodeParameter('componentName', i);
                const csrfMetaRegex = this.getNodeParameter('csrfMetaRegex', i);
                const usernameField = this.getNodeParameter('usernameField', i);
                const passwordField = this.getNodeParameter('passwordField', i);
                const impersonate = this.getNodeParameter('impersonate', i);
                const startRes = (await this.helpers.httpRequest({
                    method: 'POST',
                    url: `${proxyUrl}/session/start`,
                    body: { base_url: baseUrl, impersonate },
                    json: true,
                }));
                const session = startRes.id;
                if (!session) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Proxy did not return a session id.', { itemIndex: i });
                }
                const getRes = (await this.helpers.httpRequest({
                    method: 'GET',
                    url: `${proxyUrl}/p/${session}${loginPath}`,
                    returnFullResponse: true,
                }));
                if (getRes.statusCode !== 200) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Login page GET failed via proxy (status ${getRes.statusCode}).`, { itemIndex: i });
                }
                const html = `${(_a = getRes.body) !== null && _a !== void 0 ? _a : ''}`;
                const csrfMatch = html.match(new RegExp(csrfMetaRegex, 'i'));
                const csrfToken = csrfMatch ? csrfMatch[1] : null;
                if (!csrfToken) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'CSRF meta token not found on login page.', { itemIndex: i });
                }
                const snapshots = [...html.matchAll(/wire:snapshot=["']([^"']+)["']/g)].map((m) => m[1]);
                let loginSnapshot = null;
                for (const raw of snapshots) {
                    const dec = htmlDecode(raw);
                    try {
                        const parsed = JSON.parse(dec);
                        if (((_b = parsed === null || parsed === void 0 ? void 0 : parsed.memo) === null || _b === void 0 ? void 0 : _b.name) === componentName) {
                            loginSnapshot = dec;
                            break;
                        }
                    }
                    catch (e) {
                    }
                }
                if (!loginSnapshot) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Livewire login snapshot (memo.name="${componentName}") not found on page.`, { itemIndex: i });
                }
                const body = JSON.stringify({
                    _token: csrfToken,
                    components: [
                        {
                            snapshot: loginSnapshot,
                            updates: {
                                [usernameField]: username,
                                [passwordField]: password,
                            },
                            calls: [{ path: '', method: 'login', params: [] }],
                        },
                    ],
                });
                const postRes = (await this.helpers.httpRequest({
                    method: 'POST',
                    url: `${proxyUrl}/p/${session}${updatePath}`,
                    headers: {
                        'Content-Type': 'application/json',
                        Origin: baseUrl,
                        Referer: `${baseUrl}${loginPath}`,
                        'X-CSRF-TOKEN': csrfToken,
                    },
                    body,
                    returnFullResponse: true,
                }));
                if (postRes.statusCode >= 400) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Login POST failed via proxy (status ${postRes.statusCode}).`, { itemIndex: i });
                }
                returnData.push({
                    json: { session, proxyUrl, baseUrl },
                    pairedItem: { item: i },
                });
            }
            catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({ json: { error: error.message }, pairedItem: { item: i } });
                    continue;
                }
                throw error;
            }
        }
        return [returnData];
    }
}
exports.M7OrbeaKideLogin = M7OrbeaKideLogin;
//# sourceMappingURL=M7OrbeaKideLogin.node.js.map