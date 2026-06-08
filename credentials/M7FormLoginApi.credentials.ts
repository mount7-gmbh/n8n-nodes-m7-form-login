import { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Holds only the secret form-login credentials (username + password).
 * Stored encrypted in the n8n DB via N8N_ENCRYPTION_KEY.
 * The non-secret login flow (URLs, field names, CSRF handling) lives on the
 * M7 Form Login node, so one credential can be reused across workflows.
 */
export class M7FormLoginApi implements ICredentialType {
	name = 'm7FormLoginApi';
	displayName = 'M7 Form Login API';
	documentationUrl = '';
	properties: INodeProperties[] = [
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
		},
	];
}
