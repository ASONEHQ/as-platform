import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';

import type { PartiesRepository } from './parties.repository.js';
import { nonBlank, nonNegativeInteger } from './parties.pricing.js';
import { PartyError, type PartyMutationContext, type PartyRoomRow, type PartyRoomStatus } from './parties.types.js';

function hash(value: object): string {
  return createHash('sha256')
    .update(JSON.stringify(Object.fromEntries(Object.entries(value).sort())))
    .digest('hex');
}

function roomPayload(value: PartyRoomRow): Readonly<Record<string, unknown>> {
  return {
    room_id: value.id,
    branch_id: value.branchId,
    code: value.code,
    status: value.status,
    version: value.version.toString(),
  };
}

export class PartyRoomsService {
  public constructor(private readonly repository: PartiesRepository) {}

  public async createRoom(
    context: PartyMutationContext,
    branchIds: readonly string[],
    key: string,
    input: {
      id?: string;
      branchId: string;
      code: string;
      name: string;
      capacityChildren?: number;
      capacityAdults?: number;
      capacityTotal?: number;
      color?: string;
      notes?: string;
    },
  ): Promise<{ value: PartyRoomRow; replayed: boolean }> {
    if (!branchIds.includes(input.branchId))
      throw new PartyError('validation_error', 'The branch is not authorized for this actor.');
    const code = nonBlank(input.code, 'code', 64);
    const name = nonBlank(input.name, 'name', 160);
    const capacityChildren =
      input.capacityChildren === undefined ? null : nonNegativeInteger(input.capacityChildren, 'capacity_children');
    const capacityAdults =
      input.capacityAdults === undefined ? null : nonNegativeInteger(input.capacityAdults, 'capacity_adults');
    const capacityTotal =
      input.capacityTotal === undefined ? null : nonNegativeInteger(input.capacityTotal, 'capacity_total');
    const color = input.color === undefined ? null : nonBlank(input.color, 'color', 32);
    const notes = input.notes === undefined ? null : input.notes.trim().length === 0 ? null : nonBlank(input.notes, 'notes', 2000);
    const id = input.id ?? randomUUID();
    const requestHash = hash({
      branchId: input.branchId,
      code,
      name,
      capacityChildren,
      capacityAdults,
      capacityTotal,
      color,
      notes,
      id: input.id ?? null,
    });
    return this.repository.transaction((client) =>
      this.repository.idempotent(
        client,
        context,
        'party_room.create',
        key,
        requestHash,
        'party_room',
        decodeRoom,
        async () => {
          const created = await this.repository.insertRoom(client, {
            id,
            companyId: context.companyId,
            branchId: input.branchId,
            code,
            name,
            capacityChildren,
            capacityAdults,
            capacityTotal,
            color,
            notes,
            actorId: context.actorId,
            timestamp: context.timestamp,
          });
          await this.repository.auditAndPublish(client, context, {
            action: 'party_room.created',
            resourceType: 'party_room',
            resourceId: created.id,
            eventType: 'party_room.created',
            branchId: created.branchId,
            version: created.version,
            payload: roomPayload(created),
          });
          return created;
        },
      ),
    );
  }

  public async room(companyId: string, branchIds: readonly string[], id: string): Promise<PartyRoomRow> {
    const value = await this.repository.room(companyId, id);
    if (value === null || !branchIds.includes(value.branchId))
      throw new PartyError('resource_not_found', 'The room was not found.');
    return value;
  }

  public listRooms(
    companyId: string,
    branchIds: readonly string[],
    input: Parameters<PartiesRepository['listRooms']>[2],
  ): ReturnType<PartiesRepository['listRooms']> {
    return this.repository.listRooms(companyId, branchIds, input);
  }

  public async updateRoom(
    context: PartyMutationContext,
    branchIds: readonly string[],
    id: string,
    expectedVersion: bigint,
    input: {
      status?: PartyRoomStatus;
      capacityChildren?: number | null;
      capacityAdults?: number | null;
      capacityTotal?: number | null;
      color?: string | null;
      notes?: string | null;
    },
  ): Promise<PartyRoomRow> {
    return this.repository.transaction(async (client) => {
      const current = await this.repository.lockRoom(client, context.companyId, id);
      if (current === null || !branchIds.includes(current.branchId))
        throw new PartyError('resource_not_found', 'The room was not found.');
      const updated = await this.repository.updateRoom(client, context.companyId, id, expectedVersion, {
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.capacityChildren === undefined
          ? {}
          : { capacityChildren: input.capacityChildren === null ? null : nonNegativeInteger(input.capacityChildren, 'capacity_children') }),
        ...(input.capacityAdults === undefined
          ? {}
          : { capacityAdults: input.capacityAdults === null ? null : nonNegativeInteger(input.capacityAdults, 'capacity_adults') }),
        ...(input.capacityTotal === undefined
          ? {}
          : { capacityTotal: input.capacityTotal === null ? null : nonNegativeInteger(input.capacityTotal, 'capacity_total') }),
        ...(input.color === undefined ? {} : { color: input.color }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        updatedBy: context.actorId,
        timestamp: context.timestamp,
      });
      await this.repository.auditAndPublish(client, context, {
        action: 'party_room.updated',
        resourceType: 'party_room',
        resourceId: updated.id,
        eventType: 'party_room.updated',
        branchId: updated.branchId,
        version: updated.version,
        payload: roomPayload(updated),
      });
      return updated;
    });
  }
}

function decodeRoom(raw: unknown): PartyRoomRow {
  const value = raw as Omit<PartyRoomRow, 'version' | 'createdAt' | 'updatedAt'> & {
    version: string;
    createdAt: string;
    updatedAt: string;
  };
  return { ...value, version: BigInt(value.version), createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) };
}
