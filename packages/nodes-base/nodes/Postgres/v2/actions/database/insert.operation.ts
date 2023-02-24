import type { IExecuteFunctions } from 'n8n-core';
import type { INodeExecutionData, INodeProperties } from 'n8n-workflow';

import { updateDisplayOptions } from '../../../../../utils/utilities';
import type { QueryMode } from '../../helpers/interfaces';
import type { PgpClient, PgpDatabase } from '../../helpers/utils';
import {
	generateReturning,
	getItemCopy,
	getItemsCopy,
	prepareError,
	wrapData,
} from '../../helpers/utils';

import { optionsCollection } from '../common.descriptions';

const properties: INodeProperties[] = [
	{
		displayName: 'Schema',
		name: 'schema',
		type: 'string',
		default: 'public',
		required: true,
		description: 'Name of the schema the table belongs to',
	},
	{
		displayName: 'Table',
		name: 'table',
		type: 'string',
		default: '',
		required: true,
		description: 'Name of the table in which to insert data to',
	},
	{
		displayName: 'Columns',
		name: 'columns',
		type: 'string',
		default: '',
		// eslint-disable-next-line n8n-nodes-base/node-param-placeholder-miscased-id
		placeholder: 'id:int,name:text,description',
		// eslint-disable-next-line n8n-nodes-base/node-param-description-miscased-id
		description:
			'Comma-separated list of the properties which should used as columns for the new rows. You can use type casting with colons (:) like id:int.',
	},
	{
		displayName: 'Return Fields',
		name: 'returnFields',
		type: 'string',
		requiresDataPath: 'multiple',
		default: '*',
		description: 'Comma-separated list of the fields that the operation will return',
	},
	optionsCollection,
];

const displayOptions = {
	show: {
		resource: ['database'],
		operation: ['insert'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);

export async function execute(
	this: IExecuteFunctions,
	pgp: PgpClient,
	db: PgpDatabase,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	let returnData: INodeExecutionData[] = [];
	const table = this.getNodeParameter('table', 0) as string;
	const schema = this.getNodeParameter('schema', 0) as string;
	const columnString = this.getNodeParameter('columns', 0) as string;
	const guardedColumns: { [key: string]: string } = {};

	const columns = columnString
		.split(',')
		.map((column) => column.trim().split(':'))
		.map(([name, cast], i) => {
			guardedColumns[`column${i}`] = name;
			return { name, cast, prop: `column${i}` };
		});

	const columnNames = columns.map((column) => column.name);

	const cs = new pgp.helpers.ColumnSet(columns, { table: { table, schema } });

	const options = this.getNodeParameter('options', 0);
	const mode = (options.mode as QueryMode) || 'multiple';

	const returning = generateReturning(pgp, this.getNodeParameter('returnFields', 0) as string);

	if (mode === 'multiple') {
		const query =
			pgp.helpers.insert(getItemsCopy(items, columnNames, guardedColumns), cs) + returning;
		const queryResult = await db.any(query);
		returnData = queryResult
			.map((result, i) => {
				return this.helpers.constructExecutionMetaData(wrapData(result), {
					itemData: { item: i },
				});
			})
			.flat();
	}

	if (mode === 'transaction') {
		returnData = await db.tx(async (t) => {
			const result: INodeExecutionData[] = [];
			for (let i = 0; i < items.length; i++) {
				const itemCopy = getItemCopy(items[i], columnNames, guardedColumns);
				try {
					const insertResult = await t.one(pgp.helpers.insert(itemCopy, cs) + returning);
					result.push(
						...this.helpers.constructExecutionMetaData(wrapData(insertResult), {
							itemData: { item: i },
						}),
					);
				} catch (err) {
					if (!this.continueOnFail()) throw err;
					result.push(prepareError(items, err, i));
					return result;
				}
			}
			return result;
		});
	}

	if (mode === 'independently') {
		returnData = await db.task(async (t) => {
			const result: INodeExecutionData[] = [];
			for (let i = 0; i < items.length; i++) {
				const itemCopy = getItemCopy(items[i], columnNames, guardedColumns);
				try {
					const insertResult = await t.oneOrNone(pgp.helpers.insert(itemCopy, cs) + returning);
					if (insertResult !== null) {
						const executionData = this.helpers.constructExecutionMetaData(wrapData(insertResult), {
							itemData: { item: i },
						});
						result.push(...executionData);
					}
				} catch (err) {
					if (!this.continueOnFail()) throw err;
					result.push(prepareError(items, err, i));
				}
			}
			return result;
		});
	}

	return returnData;
}
