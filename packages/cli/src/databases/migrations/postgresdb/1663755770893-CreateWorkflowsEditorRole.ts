import type { MigrationContext, MigrationInterface } from '@db/types';

export class CreateWorkflowsEditorRole1663755770893 implements MigrationInterface {
	async up({ queryRunner, tablePrefix }: MigrationContext) {
		await queryRunner.query(`
			INSERT INTO ${tablePrefix}role (name, scope)
			VALUES ('editor', 'workflow')
			ON CONFLICT DO NOTHING;
		`);
	}

	async down({ queryRunner, tablePrefix }: MigrationContext) {
		await queryRunner.query(`
			DELETE FROM ${tablePrefix}role WHERE name='user' AND scope='workflow';
		`);
	}
}
