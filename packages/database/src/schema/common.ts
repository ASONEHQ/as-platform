import type { HasDefault, NotNull } from 'drizzle-orm/column-builder';
import { timestamp, uuid } from 'drizzle-orm/pg-core';
import type { PgTimestampBuilderInitial } from 'drizzle-orm/pg-core/columns/timestamp';
import type { PgUUIDBuilderInitial } from 'drizzle-orm/pg-core/columns/uuid';
import { v7 as uuidv7 } from 'uuid';

type IdBuilder = HasDefault<NotNull<PgUUIDBuilderInitial<'id'>>>;
type CompanyIdBuilder = NotNull<PgUUIDBuilderInitial<'company_id'>>;
type CreatedAtBuilder = HasDefault<NotNull<PgTimestampBuilderInitial<'created_at'>>>;
type UpdatedAtBuilder = HasDefault<NotNull<PgTimestampBuilderInitial<'updated_at'>>>;

export const idColumn = (): IdBuilder => uuid('id').primaryKey().$defaultFn(uuidv7);
export const companyIdColumn = (): CompanyIdBuilder => uuid('company_id').notNull();
export const createdAtColumn = (): CreatedAtBuilder =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
export const updatedAtColumn = (): UpdatedAtBuilder =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
