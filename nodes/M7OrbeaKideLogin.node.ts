import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

/**
 * Orbea "kide" (Laravel Livewire) login node.
 *
 * "Login" here means: prepare a session in the in-house TLS-impersonation proxy
 * (Cloudflare bypass) and authenticate it. The node:
 *   1. asks the proxy to start a session for the base URL,
 *   2. GETs the login page through the session (CSRF meta + Livewire snapshot),
 *   3. POSTs the Livewire login through the session (credentials injected).
 *
 * The auth cookies live ONLY in the proxy session. The node outputs just the
 * session id, which downstream nodes use as `<proxy>/p/<id>/<path>` for all
 * further Orbea requests. Credentials are sent only to the in-house proxy and
 * never written to node output — no leak into execution data or backups.
 */
export class M7OrbeaKideLogin implements INodeType {
	description: INodeTypeDescription;

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

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const htmlDecode = (s: string): string =>
			s
				.replace(/&quot;/g, '"')
				.replace(/&amp;/g, '&')
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>');

		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('m7FormLoginApi');
		const username = credentials.username as string;
		const password = credentials.password as string;

		for (let i = 0; i < items.length; i++) {
			try {
				const proxyUrl = (this.getNodeParameter('proxyUrl', i) as string).replace(/\/+$/, '');
				const baseUrl = (this.getNodeParameter('baseUrl', i) as string).replace(/\/+$/, '');
				const loginPath = this.getNodeParameter('loginPath', i) as string;
				const updatePath = this.getNodeParameter('updatePath', i) as string;
				const componentName = this.getNodeParameter('componentName', i) as string;
				const csrfMetaRegex = this.getNodeParameter('csrfMetaRegex', i) as string;
				const usernameField = this.getNodeParameter('usernameField', i) as string;
				const passwordField = this.getNodeParameter('passwordField', i) as string;
				const impersonate = this.getNodeParameter('impersonate', i) as string;

				// 1. Prepare a proxy session bound to the site
				const startRes = (await this.helpers.httpRequest({
					method: 'POST',
					url: `${proxyUrl}/session/start`,
					body: { base_url: baseUrl, impersonate },
					json: true,
				})) as { id: string };
				const session = startRes.id;
				if (!session) {
					throw new NodeOperationError(this.getNode(), 'Proxy did not return a session id.', { itemIndex: i });
				}

				// 2. GET login page through the session
				const getRes = (await this.helpers.httpRequest({
					method: 'GET',
					url: `${proxyUrl}/p/${session}${loginPath}`,
					returnFullResponse: true,
				})) as { statusCode: number; body: unknown };
				if (getRes.statusCode !== 200) {
					throw new NodeOperationError(this.getNode(), `Login page GET failed via proxy (status ${getRes.statusCode}).`, { itemIndex: i });
				}
				const html = `${getRes.body ?? ''}`;

				const csrfMatch = html.match(new RegExp(csrfMetaRegex, 'i'));
				const csrfToken = csrfMatch ? csrfMatch[1] : null;
				if (!csrfToken) {
					throw new NodeOperationError(this.getNode(), 'CSRF meta token not found on login page.', { itemIndex: i });
				}

				const snapshots = [...html.matchAll(/wire:snapshot=["']([^"']+)["']/g)].map((m) => m[1]);
				let loginSnapshot: string | null = null;
				for (const raw of snapshots) {
					const dec = htmlDecode(raw);
					try {
						const parsed = JSON.parse(dec);
						if (parsed?.memo?.name === componentName) {
							loginSnapshot = dec;
							break;
						}
					} catch (e) {
						// not the component — skip
					}
				}
				if (!loginSnapshot) {
					throw new NodeOperationError(
						this.getNode(),
						`Livewire login snapshot (memo.name="${componentName}") not found on page.`,
						{ itemIndex: i },
					);
				}

				// 3. POST Livewire login through the session (secrets only to in-house proxy)
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
				})) as { statusCode: number };
				// Livewire returns 200 (stay) or 302/303 (redirect) on success.
				if (postRes.statusCode >= 400) {
					throw new NodeOperationError(this.getNode(), `Login POST failed via proxy (status ${postRes.statusCode}).`, { itemIndex: i });
				}

				returnData.push({
					json: { session, proxyUrl, baseUrl },
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
