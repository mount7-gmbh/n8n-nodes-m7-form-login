import {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

/**
 * Generic form-login node.
 *
 * Reads username/password from an encrypted credential, performs an optional
 * GET (to harvest CSRF token + initial cookies) followed by an
 * application/x-www-form-urlencoded POST, and returns ONLY the resulting auth
 * cookie. The username/password are used inside helpers.httpRequest — they are
 * never written to node output, so they cannot leak into execution data or
 * backups. Solves the JobRad/Orbea/Assona form-login leak.
 */
export class M7FormLogin implements INodeType {
	description: INodeTypeDescription;

	constructor() {
		this.description = {
			displayName: 'M7 Form Login',
			name: 'm7FormLogin',
			icon: 'file:m7-form-login.svg',
			group: ['transform'],
			version: 1.0,
			description: 'Logs in via an x-www-form-urlencoded form and returns only the auth cookie. Secrets stay in the credential.',
			defaults: {
				name: 'M7 Form Login',
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
					displayName: 'Login Page URL (GET)',
					name: 'loginPageUrl',
					type: 'string',
					default: '',
					placeholder: 'https://fachhandel.jobrad.org/supplier/login',
					description: 'Optional. GET this URL first to collect initial cookies and (if configured) a CSRF token. Leave empty to skip.',
				},
				{
					displayName: 'CSRF Token Regex',
					name: 'csrfRegex',
					type: 'string',
					default: '<input[^>]+name="csrf_token"[^>]+value="([^"]*)"',
					description: 'Regex with exactly one capture group, applied to the GET response body to extract the CSRF token. Only used if a Login Page URL is set and "Send CSRF Field" is on.',
				},
				{
					displayName: 'Login URL (POST)',
					name: 'loginUrl',
					type: 'string',
					default: '',
					required: true,
					placeholder: 'https://fachhandel.jobrad.org/supplier/login',
				},
				{
					displayName: 'Username Field Name',
					name: 'usernameField',
					type: 'string',
					default: 'login',
					required: true,
				},
				{
					displayName: 'Password Field Name',
					name: 'passwordField',
					type: 'string',
					default: 'password',
					required: true,
				},
				{
					displayName: 'Send CSRF Field',
					name: 'includeCsrf',
					type: 'boolean',
					default: true,
				},
				{
					displayName: 'CSRF Field Name',
					name: 'csrfField',
					type: 'string',
					default: 'csrf_token',
					displayOptions: {
						show: {
							includeCsrf: [true],
						},
					},
				},
				{
					displayName: 'Extra Body Parameters',
					name: 'extraBodyParams',
					type: 'fixedCollection',
					typeOptions: {
						multipleValues: true,
					},
					default: {},
					description: 'Additional fixed fields sent in the form body, e.g. type=login',
					options: [
						{
							name: 'parameter',
							displayName: 'Parameter',
							values: [
								{ displayName: 'Name', name: 'name', type: 'string', default: '' },
								{ displayName: 'Value', name: 'value', type: 'string', default: '' },
							],
						},
					],
				},
				{
					displayName: 'Extra Headers',
					name: 'extraHeaders',
					type: 'fixedCollection',
					typeOptions: {
						multipleValues: true,
					},
					default: {},
					description: 'Additional headers for both GET and POST, e.g. Referer',
					options: [
						{
							name: 'parameter',
							displayName: 'Header',
							values: [
								{ displayName: 'Name', name: 'name', type: 'string', default: '' },
								{ displayName: 'Value', name: 'value', type: 'string', default: '' },
							],
						},
					],
				},
				{
					displayName: 'Follow Redirects',
					name: 'followRedirects',
					type: 'boolean',
					default: false,
					description: 'Whether to follow the redirect after a successful login POST',
				},
				{
					displayName: 'Output',
					name: 'outputMode',
					type: 'options',
					default: 'cookieHeader',
					options: [
						{
							name: 'Cookie Header Only',
							value: 'cookieHeader',
							description: 'Output { headers: { Cookie } } ready to plug into an HTTP Request node',
						},
						{
							name: 'Full Response (no secrets)',
							value: 'fullResponse',
							description: 'Output status, response headers, body and the cookie. Never includes username/password.',
						},
					],
				},
				{
					displayName: 'Output Field Name',
					name: 'outputFieldName',
					type: 'string',
					default: 'auth',
				},
			],
		};
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		// Parse Set-Cookie header(s) into a name->value map, dropping expired cookies.
		const parseSetCookie = (
			setCookieHeader: string | string[] | undefined,
			jar: Map<string, string>,
		): void => {
			if (!setCookieHeader) {
				return;
			}
			const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
			for (const cookieStr of cookies) {
				const parts = cookieStr.split(';');
				const nameValue = parts[0].trim();
				if (!nameValue || nameValue.indexOf('=') === -1) {
					continue;
				}
				let isExpired = false;
				for (const part of parts) {
					if (part.trim().toLowerCase().startsWith('expires=')) {
						const expiresDate = new Date(part.split('=')[1]);
						if (!isNaN(expiresDate.getTime()) && expiresDate < new Date()) {
							isExpired = true;
						}
						break;
					}
				}
				const eq = nameValue.indexOf('=');
				const name = nameValue.substring(0, eq);
				const value = nameValue.substring(eq + 1);
				if (isExpired) {
					jar.delete(name);
				} else {
					jar.set(name, value);
				}
			}
		};

		const jarToString = (jar: Map<string, string>): string =>
			Array.from(jar.entries())
				.map(([k, v]) => `${k}=${v}`)
				.join('; ');

		const collectionToObject = (
			coll: IDataObject,
		): Record<string, string> => {
			const out: Record<string, string> = {};
			const arr = (coll?.parameter as IDataObject[]) || [];
			for (const p of arr) {
				if (p.name) {
					out[p.name as string] = (p.value as string) ?? '';
				}
			}
			return out;
		};

		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = await this.getCredentials('m7FormLoginApi');
		const username = credentials.username as string;
		const password = credentials.password as string;

		for (let i = 0; i < items.length; i++) {
			try {
				const loginPageUrl = this.getNodeParameter('loginPageUrl', i, '') as string;
				const csrfRegex = this.getNodeParameter('csrfRegex', i, '') as string;
				const loginUrl = this.getNodeParameter('loginUrl', i) as string;
				const usernameField = this.getNodeParameter('usernameField', i) as string;
				const passwordField = this.getNodeParameter('passwordField', i) as string;
				const includeCsrf = this.getNodeParameter('includeCsrf', i, true) as boolean;
				const csrfField = this.getNodeParameter('csrfField', i, 'csrf_token') as string;
				const followRedirects = this.getNodeParameter('followRedirects', i, false) as boolean;
				const outputMode = this.getNodeParameter('outputMode', i, 'cookieHeader') as string;
				const outputFieldName = this.getNodeParameter('outputFieldName', i, 'auth') as string;

				const extraBody = collectionToObject(
					this.getNodeParameter('extraBodyParams', i, {}) as IDataObject,
				);
				const extraHeaders = collectionToObject(
					this.getNodeParameter('extraHeaders', i, {}) as IDataObject,
				);

				const jar = new Map<string, string>();
				let csrfToken = '';

				// 1. Optional GET: harvest cookies + CSRF token
				if (loginPageUrl) {
					const getOptions: IHttpRequestOptions = {
						method: 'GET',
						url: loginPageUrl,
						headers: { ...extraHeaders },
						returnFullResponse: true,
						ignoreHttpStatusErrors: true,
					};
					const getResponse = await this.helpers.httpRequest(getOptions);
					parseSetCookie(getResponse.headers['set-cookie'] as string | string[] | undefined, jar);

					if (includeCsrf && csrfRegex) {
						const body = typeof getResponse.body === 'string'
							? getResponse.body
							: JSON.stringify(getResponse.body);
						const match = body.match(new RegExp(csrfRegex));
						if (!match || match[1] === undefined) {
							throw new NodeOperationError(
								this.getNode(),
								'Could not extract CSRF token from login page with the given regex.',
								{ itemIndex: i },
							);
						}
						csrfToken = match[1];
					}
				}

				// 2. Build form body (secrets used here only — never returned)
				const bodyParams: Record<string, string> = {
					...extraBody,
					[usernameField]: username,
					[passwordField]: password,
				};
				if (includeCsrf && csrfToken) {
					bodyParams[csrfField] = csrfToken;
				}

				// 3. POST login
				const cookieString = jarToString(jar);
				const postOptions: IHttpRequestOptions = {
					method: 'POST',
					url: loginUrl,
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						...extraHeaders,
						...(cookieString ? { Cookie: cookieString } : {}),
					},
					body: new URLSearchParams(bodyParams).toString(),
					returnFullResponse: true,
					disableFollowRedirect: !followRedirects,
					ignoreHttpStatusErrors: true,
				};
				const postResponse = await this.helpers.httpRequest(postOptions);

				if (
					postResponse.statusCode !== 200 &&
					postResponse.statusCode !== 302 &&
					postResponse.statusCode !== 303
				) {
					throw new NodeOperationError(
						this.getNode(),
						`Login failed. Status code: ${postResponse.statusCode}`,
						{ itemIndex: i },
					);
				}

				// 4. Merge POST cookies (override GET cookies of same name)
				parseSetCookie(postResponse.headers['set-cookie'] as string | string[] | undefined, jar);
				const finalCookie = jarToString(jar);

				let responseData: IDataObject;
				if (outputMode === 'fullResponse') {
					responseData = {
						statusCode: postResponse.statusCode,
						headers: postResponse.headers,
						body: postResponse.body,
						cookie: finalCookie,
					};
				} else {
					responseData = {
						headers: { Cookie: finalCookie },
					};
				}

				returnData.push({
					json: { [outputFieldName]: responseData },
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
