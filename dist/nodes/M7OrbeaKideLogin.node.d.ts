import { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
export declare class M7OrbeaKideLogin implements INodeType {
    description: INodeTypeDescription;
    constructor();
    execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]>;
}
