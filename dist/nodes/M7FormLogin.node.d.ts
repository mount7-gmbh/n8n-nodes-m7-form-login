import { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
export declare class M7FormLogin implements INodeType {
    description: INodeTypeDescription;
    constructor();
    execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
}
