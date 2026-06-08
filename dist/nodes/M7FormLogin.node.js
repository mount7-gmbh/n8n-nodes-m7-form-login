"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.M7FormLogin = void 0;
const n8n_workflow_1 = require("n8n-workflow");
class M7FormLogin {
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
    async execute() {
        const parseSetCookie = (setCookieHeader, jar) => {
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
                }
                else {
                    jar.set(name, value);
                }
            }
        };
        const jarToString = (jar) => Array.from(jar.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
        const collectionToObject = (coll) => {
            var _a;
            const out = {};
            const arr = (coll === null || coll === void 0 ? void 0 : coll.parameter) || [];
            for (const p of arr) {
                if (p.name) {
                    out[p.name] = (_a = p.value) !== null && _a !== void 0 ? _a : '';
                }
            }
            return out;
        };
        const items = this.getInputData();
        const returnData = [];
        const credentials = await this.getCredentials('m7FormLoginApi');
        const username = credentials.username;
        const password = credentials.password;
        for (let i = 0; i < items.length; i++) {
            try {
                const loginPageUrl = this.getNodeParameter('loginPageUrl', i, '');
                const csrfRegex = this.getNodeParameter('csrfRegex', i, '');
                const loginUrl = this.getNodeParameter('loginUrl', i);
                const usernameField = this.getNodeParameter('usernameField', i);
                const passwordField = this.getNodeParameter('passwordField', i);
                const includeCsrf = this.getNodeParameter('includeCsrf', i, true);
                const csrfField = this.getNodeParameter('csrfField', i, 'csrf_token');
                const followRedirects = this.getNodeParameter('followRedirects', i, false);
                const outputMode = this.getNodeParameter('outputMode', i, 'cookieHeader');
                const outputFieldName = this.getNodeParameter('outputFieldName', i, 'auth');
                const extraBody = collectionToObject(this.getNodeParameter('extraBodyParams', i, {}));
                const extraHeaders = collectionToObject(this.getNodeParameter('extraHeaders', i, {}));
                const jar = new Map();
                let csrfToken = '';
                if (loginPageUrl) {
                    const getOptions = {
                        method: 'GET',
                        url: loginPageUrl,
                        headers: { ...extraHeaders },
                        returnFullResponse: true,
                        ignoreHttpStatusErrors: true,
                    };
                    const getResponse = await this.helpers.httpRequest(getOptions);
                    parseSetCookie(getResponse.headers['set-cookie'], jar);
                    if (includeCsrf && csrfRegex) {
                        const body = typeof getResponse.body === 'string'
                            ? getResponse.body
                            : JSON.stringify(getResponse.body);
                        const match = body.match(new RegExp(csrfRegex));
                        if (!match || match[1] === undefined) {
                            throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Could not extract CSRF token from login page with the given regex.', { itemIndex: i });
                        }
                        csrfToken = match[1];
                    }
                }
                const bodyParams = {
                    ...extraBody,
                    [usernameField]: username,
                    [passwordField]: password,
                };
                if (includeCsrf && csrfToken) {
                    bodyParams[csrfField] = csrfToken;
                }
                const cookieString = jarToString(jar);
                const postOptions = {
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
                if (postResponse.statusCode !== 200 &&
                    postResponse.statusCode !== 302 &&
                    postResponse.statusCode !== 303) {
                    throw new n8n_workflow_1.NodeOperationError(this.getNode(), `Login failed. Status code: ${postResponse.statusCode}`, { itemIndex: i });
                }
                parseSetCookie(postResponse.headers['set-cookie'], jar);
                const finalCookie = jarToString(jar);
                let responseData;
                if (outputMode === 'fullResponse') {
                    responseData = {
                        statusCode: postResponse.statusCode,
                        headers: postResponse.headers,
                        body: postResponse.body,
                        cookie: finalCookie,
                    };
                }
                else {
                    responseData = {
                        headers: { Cookie: finalCookie },
                    };
                }
                returnData.push({
                    json: { [outputFieldName]: responseData },
                    pairedItem: { item: i },
                });
            }
            catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: { error: error.message },
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
exports.M7FormLogin = M7FormLogin;
//# sourceMappingURL=M7FormLogin.node.js.map