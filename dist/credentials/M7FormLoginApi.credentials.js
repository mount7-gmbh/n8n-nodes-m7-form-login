"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.M7FormLoginApi = void 0;
class M7FormLoginApi {
    constructor() {
        this.name = 'm7FormLoginApi';
        this.displayName = 'M7 Form Login API';
        this.documentationUrl = '';
        this.properties = [
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
}
exports.M7FormLoginApi = M7FormLoginApi;
//# sourceMappingURL=M7FormLoginApi.credentials.js.map