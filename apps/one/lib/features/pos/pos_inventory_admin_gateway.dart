/// TASK 15.1 Phase 3: the Flutter side of the six real, permission-gated
/// inventory backend capabilities `docs/RC_RELEASE_INVENTORY.md`'s
/// INVENTORY section found with zero Flutter UI, plus locations (its own
/// bonus finding, currently only implied by the read-only balances view) —
/// manual movement drafts/adjustments + posting
/// (`inventory-drafts.routes.ts`/`inventory-posting.routes.ts`),
/// reservations (`reservation.routes.ts`), physical counts
/// (`inventory-counts.routes.ts`), reconciliation findings/repairs
/// (`inventory-reconciliation.routes.ts`), movement reversal
/// (`inventory-reversal.routes.ts`), branch-to-branch transfers
/// (`inventory-transfers.routes.ts`), and locations
/// (`inventory.routes.ts:203-338`).
///
/// ONE gateway file/interface (`PosInventoryAdminGateway`) rather than one
/// per sub-domain — `pos_inventory_admin_screen.dart`'s own constructor
/// contract takes a single `gateway` parameter, and every one of these
/// seven surfaces lives under the backend's own single `inventory` module
/// (mirrors this app's existing choice for `pos_people_gateway.dart`, one
/// file/four interface groups for one shared backend module — just flattened
/// to one interface here since every method here is gated by a `inventory.*`
/// permission code from the exact same catalog, unlike People's four
/// distinct permission families).
///
/// Styled exactly after `pos_people_gateway.dart`/`pos_suppliers_gateway.dart`:
/// `PosX`/`PosXPage` model classes with `fromJson`, an abstract interface
/// class, an `Api...` implementation using `ApiClient`, and an `Empty...`
/// implementation for screens/tests with no gateway wired yet.
///
/// Real backend contract quirks this file must honor (every one confirmed
/// by direct route/service/repository inspection, never guessed):
///  * Every mutating endpoint here uses real optimistic concurrency (a
///    strong `If-Match` version header) and/or a real `Idempotency-Key`
///    header — see each method's own doc comment for the exact headers its
///    route requires.
///  * `inventory-posting.routes.ts`'s `submit`/`post` endpoints are the
///    ONLY bodyless `POST`s in this whole backend that actively REJECT a
///    defined body (even `{}`) — see `api_client.dart`'s `postJson`
///    `omitBody` parameter, added by this same task to make those two
///    endpoints callable at all.
///  * A movement's own JSON (`movementJson` in `inventory-drafts.service.ts`)
///    never carries an actor id for who created/posted/cancelled it — only
///    real timestamps. This app never fabricates a "posted by" name for a
///    resource the backend genuinely doesn't return one for (see
///    `pos_inventory_admin_screen.dart`'s own doc comment on this).
///  * `GET .../movements` (list) omits `line_count` entirely (a lighter
///    list projection, not present in the detail row) — [PosInventoryMovement
///    .lineCount] is therefore nullable.
///  * List rows across drafts/reconciliation use `version::text` (a JSON
///    STRING) while their own detail/mutation endpoints send `Number(...)`
///    (a JSON number) for the exact same field — this file's [_versionOf]
///    parses either form; not a bug this task's scope allows fixing
///    backend-side, just an existing inconsistency to parse defensively.
library;

import '../../core/networking/api_client.dart';

// ---------------------------------------------------------------------
// Shared parsing helpers
// ---------------------------------------------------------------------

int _versionOf(Object? value) {
  if (value is int) return value;
  if (value is String) return int.parse(value);
  throw FormatException('Invalid version value: $value');
}

int? _optionalInt(Object? value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is String) return int.parse(value);
  throw FormatException('Invalid integer value: $value');
}

DateTime? _optionalDate(Object? value) => value == null ? null : DateTime.parse(value as String);

({List<Map<String, Object?>> items, String? nextCursor}) _page(
  Map<String, Object?> envelope,
  String label,
) {
  final data = envelope['data'];
  if (data is! List<Object?>) {
    throw FormatException('Missing $label list data.');
  }
  final meta = envelope['meta'];
  final page = meta is Map<String, Object?> ? meta['page'] : null;
  final nextCursor = page is Map<String, Object?> ? page['next_cursor'] as String? : null;
  return (items: data.whereType<Map<String, Object?>>().toList(growable: false), nextCursor: nextCursor);
}

Map<String, Object?> _single(Map<String, Object?> envelope, String label) {
  final data = envelope['data'];
  if (data is! Map<String, Object?>) {
    throw FormatException('Missing $label data.');
  }
  return data;
}

String _idempotencyKey(String action) => 'one-inv-$action-${DateTime.now().toUtc().microsecondsSinceEpoch}';

// ---------------------------------------------------------------------
// Ubicaciones — `inventory.routes.ts:203-338`, gated by `inventory.read`/
// `inventory_location.manage`.
// ---------------------------------------------------------------------

/// An `inventory_locations` row (`locationHttp()` in `inventory.routes.ts`)
/// — the FULL record, identical shape on both list and single-item reads.
class PosInventoryLocation {
  const PosInventoryLocation({
    required this.id,
    required this.branchId,
    required this.code,
    required this.name,
    required this.description,
    required this.locationType,
    required this.status,
    required this.allowsReceiving,
    required this.allowsIssuing,
    required this.isDefault,
    required this.version,
    required this.createdAt,
    required this.updatedAt,
    required this.deletedAt,
  });

  factory PosInventoryLocation.fromJson(Map<String, Object?> json) => PosInventoryLocation(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    code: json['code']! as String,
    name: json['name']! as String,
    description: json['description'] as String?,
    locationType: json['location_type']! as String,
    status: json['status']! as String,
    allowsReceiving: json['allows_receiving']! as bool,
    allowsIssuing: json['allows_issuing']! as bool,
    isDefault: json['is_default']! as bool,
    version: _versionOf(json['version']),
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
    deletedAt: _optionalDate(json['deleted_at']),
  );

  final String id;
  final String branchId;
  final String code;
  final String name;
  final String? description;

  /// `main` | `sales_floor` | `cafeteria` | `event_storage` | `damaged` |
  /// `returns` | `transit` | `virtual` (`locationTypes`).
  final String locationType;

  /// `active` | `inactive` | `retired` (`locationStatuses`).
  final String status;
  final bool allowsReceiving;
  final bool allowsIssuing;
  final bool isDefault;
  final int version;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? deletedAt;
}

class PosInventoryLocationPage {
  const PosInventoryLocationPage({required this.items, required this.nextCursor});
  final List<PosInventoryLocation> items;
  final String? nextCursor;
}

/// `POST /api/v1/inventory/locations` body — every field the route accepts.
class PosInventoryLocationCreateInput {
  const PosInventoryLocationCreateInput({
    required this.branchId,
    required this.code,
    required this.name,
    required this.locationType,
    this.description,
    this.status,
    this.allowsReceiving,
    this.allowsIssuing,
    this.isDefault,
  });

  final String branchId;
  final String code;
  final String name;
  final String locationType;
  final String? description;
  final String? status;
  final bool? allowsReceiving;
  final bool? allowsIssuing;
  final bool? isDefault;

  Map<String, Object?> toJson() => {
    'branch_id': branchId,
    'code': code,
    'name': name,
    'location_type': locationType,
    if (description != null) 'description': description,
    if (status != null) 'status': status,
    if (allowsReceiving != null) 'allows_receiving': allowsReceiving,
    if (allowsIssuing != null) 'allows_issuing': allowsIssuing,
    if (isDefault != null) 'is_default': isDefault,
  };
}

/// `PATCH /api/v1/inventory/locations/{id}` body — a genuine partial update.
class PosInventoryLocationPatchInput {
  const PosInventoryLocationPatchInput({
    this.name,
    this.description,
    this.status,
    this.allowsReceiving,
    this.allowsIssuing,
    this.isDefault,
  });

  final String? name;
  final String? description;
  final String? status;
  final bool? allowsReceiving;
  final bool? allowsIssuing;
  final bool? isDefault;

  Map<String, Object?> toJson() => {
    if (name != null) 'name': name,
    if (description != null) 'description': description,
    if (status != null) 'status': status,
    if (allowsReceiving != null) 'allows_receiving': allowsReceiving,
    if (allowsIssuing != null) 'allows_issuing': allowsIssuing,
    if (isDefault != null) 'is_default': isDefault,
  };
}

// ---------------------------------------------------------------------
// Balances — read-only helper (`GET /api/v1/inventory/balances`, already
// GREEN per the RC inventory audit) reused here ONLY to source a real
// variant/location picker for the tabs below — never a second, invented
// balances screen.
// ---------------------------------------------------------------------

/// An `inventory_balances` row joined with its variant/product/location
/// display names (`InventoryBalanceReadRepository.list`'s own SQL select) —
/// just enough fields for a real picker sourced from actual on-hand stock,
/// never a fabricated product search.
class PosInventoryBalance {
  const PosInventoryBalance({
    required this.branchId,
    required this.locationId,
    required this.locationCode,
    required this.locationName,
    required this.productVariantId,
    required this.sku,
    required this.variantName,
    required this.productName,
    required this.categoryName,
    required this.unitOfMeasureCode,
    required this.quantityOnHand,
    required this.quantityReserved,
    required this.quantityAvailable,
    required this.minStock,
    required this.stockStatus,
  });

  factory PosInventoryBalance.fromJson(Map<String, Object?> json) => PosInventoryBalance(
    branchId: json['branch_id']! as String,
    locationId: json['inventory_location_id']! as String,
    locationCode: json['location_code']! as String,
    locationName: json['location_name']! as String,
    productVariantId: json['product_variant_id']! as String,
    sku: json['sku']! as String,
    variantName: json['variant_name'] as String?,
    productName: json['product_name']! as String,
    categoryName: json['category_name'] as String?,
    unitOfMeasureCode: json['unit_of_measure_code']! as String,
    quantityOnHand: json['quantity_on_hand']! as String,
    quantityReserved: json['quantity_reserved']! as String,
    quantityAvailable: json['quantity_available']! as String,
    minStock: json['min_stock'] as String?,
    // TASK 16.7 §7: the backend derives this from the row's own real
    // `min_stock` (never a hardcoded threshold — see `inventory.repository
    // .ts`'s `STOCK_STATUS_EXPR`); a response predating that field falls
    // back to a bare zero-availability check, never a fabricated status.
    stockStatus: json['stock_status'] as String? ?? (json['quantity_available'] == '0.000000' ? 'out_of_stock' : 'available'),
  );

  final String branchId;
  final String locationId;
  final String locationCode;
  final String locationName;
  final String productVariantId;
  final String sku;
  final String? variantName;
  final String productName;
  final String? categoryName;
  final String unitOfMeasureCode;
  final String quantityOnHand;
  final String quantityReserved;
  final String quantityAvailable;
  final String? minStock;
  final String stockStatus;

  String get displayName => variantName == null ? '$productName ($sku)' : '$productName — $variantName ($sku)';
}

class PosInventoryBalancePage {
  const PosInventoryBalancePage({required this.items, required this.nextCursor});
  final List<PosInventoryBalance> items;
  final String? nextCursor;
}

// ---------------------------------------------------------------------
// Movimientos — manual movement drafts/adjustments + posting.
// `inventory-drafts.routes.ts` + `inventory-posting.routes.ts` +
// `inventory-reversal.routes.ts`. State machine: draft (create) → pending
// (submit, `inventory.adjust`) → posted (post, `inventory.approve`); a
// `draft`/`pending` movement can instead be cancelled (`inventory.adjust`,
// requires a reason); a `posted` movement can instead be reversed
// (`inventory.reverse`, requires a reason) — never a client-invented state.
// ---------------------------------------------------------------------

/// An `inventory_movement_lines` row (`lineJson()` in
/// `inventory-drafts.service.ts`). Cost fields are deliberately omitted —
/// only visible with `inventory.cost.read`, which this admin UI does not
/// require or display.
class PosInventoryMovementLine {
  const PosInventoryMovementLine({
    required this.id,
    required this.movementId,
    required this.lineNumber,
    required this.productVariantId,
    required this.sourceLocationId,
    required this.destinationLocationId,
    required this.quantity,
    required this.baseQuantity,
    required this.unitOfMeasureCode,
    required this.reasonCode,
    required this.createdAt,
  });

  factory PosInventoryMovementLine.fromJson(Map<String, Object?> json) => PosInventoryMovementLine(
    id: json['id']! as String,
    movementId: json['movement_id']! as String,
    lineNumber: json['line_number']! as int,
    productVariantId: json['product_variant_id']! as String,
    sourceLocationId: json['source_inventory_location_id'] as String?,
    destinationLocationId: json['destination_inventory_location_id'] as String?,
    quantity: json['quantity']! as String,
    baseQuantity: json['base_quantity']! as String,
    unitOfMeasureCode: json['unit_of_measure_code']! as String,
    reasonCode: json['reason_code'] as String?,
    createdAt: DateTime.parse(json['created_at']! as String),
  );

  final String id;
  final String movementId;
  final int lineNumber;
  final String productVariantId;
  final String? sourceLocationId;
  final String? destinationLocationId;
  final String quantity;
  final String baseQuantity;
  final String unitOfMeasureCode;
  final String? reasonCode;
  final DateTime createdAt;
}

/// An `inventory_movements` row (`movementJson()` in
/// `inventory-drafts.service.ts`). [lineCount] is `null` on a LIST row
/// (`GET .../movements`'s own SQL select omits it entirely) but always
/// present on a single-movement read/mutation result.
class PosInventoryMovement {
  const PosInventoryMovement({
    required this.id,
    required this.branchId,
    required this.movementNumber,
    required this.movementType,
    required this.status,
    required this.reasonCode,
    required this.referenceType,
    required this.referenceId,
    required this.sourceDocumentNumber,
    required this.notes,
    required this.version,
    required this.occurredAt,
    required this.postedAt,
    required this.cancelledAt,
    required this.reversedAt,
    required this.createdAt,
    required this.updatedAt,
    required this.lineCount,
  });

  factory PosInventoryMovement.fromJson(Map<String, Object?> json) => PosInventoryMovement(
    id: json['id']! as String,
    branchId: json['branch_id']! as String,
    movementNumber: json['movement_number']! as String,
    movementType: json['movement_type']! as String,
    status: json['status']! as String,
    reasonCode: json['reason_code'] as String?,
    referenceType: json['reference_type'] as String?,
    referenceId: json['reference_id'] as String?,
    sourceDocumentNumber: json['source_document_number'] as String?,
    notes: json['notes'] as String?,
    version: _versionOf(json['version']),
    occurredAt: DateTime.parse(json['occurred_at']! as String),
    postedAt: _optionalDate(json['posted_at']),
    cancelledAt: _optionalDate(json['cancelled_at']),
    reversedAt: _optionalDate(json['reversed_at']),
    createdAt: DateTime.parse(json['created_at']! as String),
    updatedAt: DateTime.parse(json['updated_at']! as String),
    lineCount: _optionalInt(json['line_count']),
  );

  final String id;
  final String branchId;
  final String movementNumber;

  /// `opening_balance` | `adjustment` (the only two a caller may CREATE via
  /// `inventory-drafts.routes.ts`; `transfer_shipment`/`transfer_receipt`/
  /// `reversal`/`receipt`/`issue`/`return` are system-generated by other
  /// flows and never created directly here).
  final String movementType;

  /// `draft` | `pending` | `posted` | `cancelled` | `reversed`
  /// (`movementStatuses`) — the real backend state machine, never a
  /// client-invented status.
  final String status;
  final String? reasonCode;
  final String? referenceType;
  final String? referenceId;
  final String? sourceDocumentNumber;
  final String? notes;
  final int version;
  final DateTime occurredAt;
  final DateTime? postedAt;
  final DateTime? cancelledAt;
  final DateTime? reversedAt;
  final DateTime createdAt;
  final DateTime updatedAt;
  final int? lineCount;

  bool get isEditable => status == 'draft' || status == 'pending';
  bool get isPosted => status == 'posted';
}

class PosInventoryMovementPage {
  const PosInventoryMovementPage({required this.items, required this.nextCursor});
  final List<PosInventoryMovement> items;
  final String? nextCursor;
}

/// `POST /api/v1/inventory/movements` body.
class PosInventoryMovementHeaderInput {
  const PosInventoryMovementHeaderInput({
    required this.branchId,
    required this.movementType,
    this.occurredAt,
    this.reasonCode,
    this.sourceDocumentNumber,
    this.notes,
  });

  final String branchId;
  final String movementType;
  final String? occurredAt;
  final String? reasonCode;
  final String? sourceDocumentNumber;
  final String? notes;

  Map<String, Object?> toJson() => {
    'branch_id': branchId,
    'movement_type': movementType,
    if (occurredAt != null) 'occurred_at': occurredAt,
    if (reasonCode != null) 'reason_code': reasonCode,
    if (sourceDocumentNumber != null) 'source_document_number': sourceDocumentNumber,
    if (notes != null) 'notes': notes,
  };
}

/// `POST /api/v1/inventory/movements/{id}/lines` body.
class PosInventoryMovementLineInput {
  const PosInventoryMovementLineInput({
    required this.productVariantId,
    required this.quantity,
    required this.unitOfMeasureCode,
    this.sourceLocationId,
    this.destinationLocationId,
    this.reasonCode,
  });

  final String productVariantId;
  final String quantity;
  final String unitOfMeasureCode;
  final String? sourceLocationId;
  final String? destinationLocationId;
  final String? reasonCode;

  Map<String, Object?> toJson() => {
    'product_variant_id': productVariantId,
    'quantity': quantity,
    'unit_of_measure_code': unitOfMeasureCode,
    if (sourceLocationId != null) 'source_inventory_location_id': sourceLocationId,
    if (destinationLocationId != null) 'destination_inventory_location_id': destinationLocationId,
    if (reasonCode != null) 'reason_code': reasonCode,
  };
}

/// `POST .../lines`/`PATCH .../lines/{id}` result — the affected line plus
/// the movement's own bumped [version] (`{line, version}` in
/// `inventory-drafts.service.ts`'s `addLine`/`patchLine`).
class PosInventoryMovementLineResult {
  const PosInventoryMovementLineResult({required this.line, required this.version});
  final PosInventoryMovementLine line;
  final int version;
}

/// `DELETE .../lines/{id}` result (`{movement_id, deleted_line_id,
/// version}`).
class PosInventoryMovementLineDeletion {
  const PosInventoryMovementLineDeletion({
    required this.movementId,
    required this.deletedLineId,
    required this.version,
  });
  final String movementId;
  final String deletedLineId;
  final int version;
}

/// `POST .../submit`/`.../post` result — a compact transition result, NOT
/// the full movement (`resultProperties` in `inventory-posting.routes.ts`).
class PosInventoryMovementTransition {
  const PosInventoryMovementTransition({
    required this.movementId,
    required this.movementNumber,
    required this.status,
    required this.version,
    required this.postedAt,
    required this.affectedBalanceCount,
  });

  factory PosInventoryMovementTransition.fromJson(Map<String, Object?> json) => PosInventoryMovementTransition(
    movementId: json['movement_id']! as String,
    movementNumber: json['movement_number']! as String,
    status: json['status']! as String,
    version: _versionOf(json['version']),
    postedAt: _optionalDate(json['posted_at']),
    affectedBalanceCount: json['affected_balance_count'] as int?,
  );

  final String movementId;
  final String movementNumber;
  final String status;
  final int version;
  final DateTime? postedAt;
  final int? affectedBalanceCount;
}

/// `POST /api/v1/inventory/movements/{id}/reversals` result
/// (`inventory-reversal.routes.ts`'s own strict response schema).
class PosInventoryReversalResult {
  const PosInventoryReversalResult({
    required this.originalMovementId,
    required this.originalVersion,
    required this.reversalMovementId,
    required this.reversalMovementNumber,
    required this.reversedAt,
    required this.affectedBalanceCount,
  });

  factory PosInventoryReversalResult.fromJson(Map<String, Object?> json) => PosInventoryReversalResult(
    originalMovementId: json['original_movement_id']! as String,
    originalVersion: _versionOf(json['original_version']),
    reversalMovementId: json['reversal_movement_id']! as String,
    reversalMovementNumber: json['reversal_movement_number']! as String,
    reversedAt: DateTime.parse(json['reversed_at']! as String),
    affectedBalanceCount: json['affected_balance_count']! as int,
  );

  final String originalMovementId;
  final int originalVersion;
  final String reversalMovementId;
  final String reversalMovementNumber;
  final DateTime reversedAt;
  final int affectedBalanceCount;
}

// ---------------------------------------------------------------------
// Traspasos — branch-to-branch transfers. `inventory-transfers.routes.ts`.
// State machine: requested (create, `inventory.transfer`) → approved/
// rejected (decision, `inventory.approve`) → shipped (`inventory.transfer`)
// → received (`inventory.receive`); `requested`/`approved` may instead be
// cancelled (`inventory.transfer`).
// ---------------------------------------------------------------------

/// An `inventory_transfer_lines` row (`lineJson()` in
/// `inventory-transfers.service.ts`).
class PosInventoryTransferLine {
  const PosInventoryTransferLine({
    required this.id,
    required this.lineNumber,
    required this.productVariantId,
    required this.quantity,
    required this.shippedQuantity,
    required this.receivedQuantity,
    required this.rejectedQuantity,
    required this.unitOfMeasureCode,
    required this.notes,
  });

  factory PosInventoryTransferLine.fromJson(Map<String, Object?> json) => PosInventoryTransferLine(
    id: json['id']! as String,
    lineNumber: json['line_number']! as int,
    productVariantId: json['product_variant_id']! as String,
    quantity: json['quantity']! as String,
    shippedQuantity: json['shipped_quantity'] as String?,
    receivedQuantity: json['received_quantity'] as String?,
    rejectedQuantity: json['rejected_quantity'] as String?,
    unitOfMeasureCode: json['unit_of_measure_code']! as String,
    notes: json['notes'] as String?,
  );

  final String id;
  final int lineNumber;
  final String productVariantId;
  final String quantity;
  final String? shippedQuantity;
  final String? receivedQuantity;
  final String? rejectedQuantity;
  final String unitOfMeasureCode;
  final String? notes;
}

/// An `inventory_transfers` row (`transferJson()` in
/// `inventory-transfers.service.ts`). [lines] is empty on a LIST row
/// (`includeLines=false` there) and populated on create/get/every
/// transition result.
class PosInventoryTransfer {
  const PosInventoryTransfer({
    required this.id,
    required this.transferNumber,
    required this.status,
    required this.sourceBranchId,
    required this.destinationBranchId,
    required this.sourceLocationId,
    required this.destinationLocationId,
    required this.transitLocationId,
    required this.notes,
    required this.version,
    required this.requestedAt,
    required this.approvedAt,
    required this.shippedAt,
    required this.receivedAt,
    required this.rejectedAt,
    required this.cancelledAt,
    required this.shipmentMovementId,
    required this.receiptMovementId,
    required this.lines,
  });

  factory PosInventoryTransfer.fromJson(Map<String, Object?> json) {
    final rawLines = json['lines'];
    return PosInventoryTransfer(
      id: json['id']! as String,
      transferNumber: json['transfer_number']! as String,
      status: json['status']! as String,
      sourceBranchId: json['source_branch_id']! as String,
      destinationBranchId: json['destination_branch_id']! as String,
      sourceLocationId: json['source_location_id']! as String,
      destinationLocationId: json['destination_location_id']! as String,
      transitLocationId: json['transit_location_id']! as String,
      notes: json['notes'] as String?,
      version: _versionOf(json['version']),
      requestedAt: DateTime.parse(json['requested_at']! as String),
      approvedAt: _optionalDate(json['approved_at']),
      shippedAt: _optionalDate(json['shipped_at']),
      receivedAt: _optionalDate(json['received_at']),
      rejectedAt: _optionalDate(json['rejected_at']),
      cancelledAt: _optionalDate(json['cancelled_at']),
      shipmentMovementId: json['shipment_movement_id'] as String?,
      receiptMovementId: json['receipt_movement_id'] as String?,
      lines: rawLines is List<Object?>
          ? rawLines.whereType<Map<String, Object?>>().map(PosInventoryTransferLine.fromJson).toList(growable: false)
          : const [],
    );
  }

  final String id;
  final String transferNumber;

  /// `requested` | `approved` | `shipped` | `received` | `rejected` |
  /// `cancelled`.
  final String status;
  final String sourceBranchId;
  final String destinationBranchId;
  final String sourceLocationId;
  final String destinationLocationId;
  final String transitLocationId;
  final String? notes;
  final int version;
  final DateTime requestedAt;
  final DateTime? approvedAt;
  final DateTime? shippedAt;
  final DateTime? receivedAt;
  final DateTime? rejectedAt;
  final DateTime? cancelledAt;
  final String? shipmentMovementId;
  final String? receiptMovementId;
  final List<PosInventoryTransferLine> lines;
}

class PosInventoryTransferPage {
  const PosInventoryTransferPage({required this.items, required this.nextCursor});
  final List<PosInventoryTransfer> items;
  final String? nextCursor;
}

class PosInventoryTransferLineInput {
  const PosInventoryTransferLineInput({
    required this.productVariantId,
    required this.quantity,
    required this.unitOfMeasureCode,
    this.notes,
  });
  final String productVariantId;
  final String quantity;
  final String unitOfMeasureCode;
  final String? notes;

  Map<String, Object?> toJson() => {
    'product_variant_id': productVariantId,
    'quantity': quantity,
    'unit_of_measure_code': unitOfMeasureCode,
    if (notes != null) 'notes': notes,
  };
}

/// `POST /api/v1/inventory/transfers` body.
class PosInventoryTransferCreateInput {
  const PosInventoryTransferCreateInput({
    required this.sourceBranchId,
    required this.destinationBranchId,
    required this.sourceLocationId,
    required this.destinationLocationId,
    required this.transitLocationId,
    required this.lines,
    this.notes,
  });

  final String sourceBranchId;
  final String destinationBranchId;
  final String sourceLocationId;
  final String destinationLocationId;
  final String transitLocationId;
  final List<PosInventoryTransferLineInput> lines;
  final String? notes;

  Map<String, Object?> toJson() => {
    'source_branch_id': sourceBranchId,
    'destination_branch_id': destinationBranchId,
    'source_location_id': sourceLocationId,
    'destination_location_id': destinationLocationId,
    'transit_location_id': transitLocationId,
    if (notes != null) 'notes': notes,
    'lines': lines.map((line) => line.toJson()).toList(growable: false),
  };
}

// ---------------------------------------------------------------------
// Conteos — physical counts. `inventory-counts.routes.ts`. State machine:
// draft (create, `inventory.count`) → counting (start, `inventory.count`,
// snapshots expected quantities) → [record each line's counted quantity,
// `inventory.count`] → submitted (submit, `inventory.count`) → approved
// (approve, `inventory.approve`) → applied (apply, `inventory.approve`,
// posts the real adjusting movement); any state before `applied` may
// instead be cancelled (`inventory.count`).
// ---------------------------------------------------------------------

/// An `inventory_count_lines` row (`inventoryCountJson()`'s own line
/// mapper in `inventory-counts.service.ts`) — one row per variant in the
/// count's snapshot scope, created by `start`, never addable/removable by
/// the client afterward (`recordLine` only ever updates an existing line).
class PosInventoryCountLine {
  const PosInventoryCountLine({
    required this.id,
    required this.productVariantId,
    required this.unitOfMeasureCode,
    required this.expectedQuantity,
    required this.countedQuantity,
    required this.differenceQuantity,
    required this.countedBy,
    required this.version,
  });

  factory PosInventoryCountLine.fromJson(Map<String, Object?> json) => PosInventoryCountLine(
    id: json['id']! as String,
    productVariantId: json['product_variant_id']! as String,
    unitOfMeasureCode: json['unit_of_measure_code']! as String,
    expectedQuantity: json['expected_quantity']! as String,
    countedQuantity: json['counted_quantity'] as String?,
    differenceQuantity: json['difference_quantity'] as String?,
    countedBy: json['counted_by'] as String?,
    version: _versionOf(json['version']),
  );

  final String id;
  final String productVariantId;
  final String unitOfMeasureCode;
  final String expectedQuantity;
  final String? countedQuantity;
  final String? differenceQuantity;
  final String? countedBy;
  final int version;

  bool get isCounted => countedQuantity != null;
}

/// An `inventory_counts` row (`inventoryCountJson()` in
/// `inventory-counts.service.ts`). [lines] is empty on a LIST row
/// (`includeLines=false` there).
class PosInventoryCount {
  const PosInventoryCount({
    required this.id,
    required this.countNumber,
    required this.branchId,
    required this.locationId,
    required this.status,
    required this.scopeType,
    required this.reasonCode,
    required this.note,
    required this.version,
    required this.startedAt,
    required this.submittedAt,
    required this.approvedAt,
    required this.appliedAt,
    required this.cancelledAt,
    required this.applicationMovementId,
    required this.createdAt,
    required this.lineCount,
    required this.uncountedLineCount,
    required this.discrepancyLineCount,
    required this.lines,
  });

  factory PosInventoryCount.fromJson(Map<String, Object?> json) {
    final rawLines = json['lines'];
    final summary = json['summary'];
    final summaryMap = summary is Map<String, Object?> ? summary : const <String, Object?>{};
    return PosInventoryCount(
      id: json['id']! as String,
      countNumber: json['count_number']! as String,
      branchId: json['branch_id']! as String,
      locationId: json['location_id']! as String,
      status: json['status']! as String,
      scopeType: (json['scope'] as Map<String, Object?>?)?['type'] as String? ?? 'all_balanced_variants',
      reasonCode: json['reason_code']! as String,
      note: json['note'] as String?,
      version: _versionOf(json['version']),
      startedAt: _optionalDate(json['started_at']),
      submittedAt: _optionalDate(json['submitted_at']),
      approvedAt: _optionalDate(json['approved_at']),
      appliedAt: _optionalDate(json['applied_at']),
      cancelledAt: _optionalDate(json['cancelled_at']),
      applicationMovementId: json['application_movement_id'] as String?,
      createdAt: DateTime.parse(json['created_at']! as String),
      lineCount: _optionalInt(summaryMap['line_count']),
      uncountedLineCount: _optionalInt(summaryMap['uncounted_line_count']),
      discrepancyLineCount: _optionalInt(summaryMap['discrepancy_line_count']),
      lines: rawLines is List<Object?>
          ? rawLines.whereType<Map<String, Object?>>().map(PosInventoryCountLine.fromJson).toList(growable: false)
          : const [],
    );
  }

  final String id;
  final String countNumber;
  final String branchId;
  final String locationId;

  /// `draft` | `counting` | `submitted` | `approved` | `applied` |
  /// `cancelled`.
  final String status;

  /// `all_balanced_variants` | `explicit_variants`.
  final String scopeType;
  final String reasonCode;
  final String? note;
  final int version;
  final DateTime? startedAt;
  final DateTime? submittedAt;
  final DateTime? approvedAt;
  final DateTime? appliedAt;
  final DateTime? cancelledAt;
  final String? applicationMovementId;
  final DateTime createdAt;
  final int? lineCount;
  final int? uncountedLineCount;
  final int? discrepancyLineCount;
  final List<PosInventoryCountLine> lines;

  bool get canCancel => status != 'applied' && status != 'cancelled';
}

class PosInventoryCountPage {
  const PosInventoryCountPage({required this.items, required this.nextCursor});
  final List<PosInventoryCount> items;
  final String? nextCursor;
}

/// `POST /api/v1/inventory/counts` body.
class PosInventoryCountCreateInput {
  const PosInventoryCountCreateInput({
    required this.branchId,
    required this.locationId,
    required this.scopeType,
    required this.reasonCode,
    this.productVariantIds,
    this.note,
  });

  final String branchId;
  final String locationId;

  /// `all_balanced_variants` | `explicit_variants`.
  final String scopeType;
  final String reasonCode;
  final List<String>? productVariantIds;
  final String? note;

  Map<String, Object?> toJson() => {
    'branch_id': branchId,
    'location_id': locationId,
    'scope': {'type': scopeType, if (productVariantIds != null) 'product_variant_ids': productVariantIds},
    'reason_code': reasonCode,
    if (note != null) 'note': note,
  };
}

// ---------------------------------------------------------------------
// Reservas — inventory reservations. `reservation.routes.ts`. State
// machine: active (create) → confirmed (confirm) | released/expired/
// cancelled (release, one of three real actions — never a single generic
// "cancel").
// ---------------------------------------------------------------------

class PosInventoryReservationLine {
  const PosInventoryReservationLine({
    required this.id,
    required this.lineNumber,
    required this.locationId,
    required this.productVariantId,
    required this.quantity,
    required this.remainingQuantity,
    required this.unitOfMeasureCode,
  });

  factory PosInventoryReservationLine.fromJson(Map<String, Object?> json) => PosInventoryReservationLine(
    id: json['id']! as String,
    lineNumber: json['line_number']! as int,
    locationId: json['location_id']! as String,
    productVariantId: json['product_variant_id']! as String,
    quantity: json['quantity']! as String,
    remainingQuantity: json['remaining_quantity'] as String?,
    unitOfMeasureCode: json['unit_of_measure_code']! as String,
  );

  final String id;
  final int lineNumber;
  final String locationId;
  final String productVariantId;
  final String quantity;
  final String? remainingQuantity;
  final String unitOfMeasureCode;
}

/// An `inventory_reservations` row (`reservationJson()` in
/// `reservation.service.ts`). [lines] is empty on a LIST row.
class PosInventoryReservation {
  const PosInventoryReservation({
    required this.id,
    required this.reservationNumber,
    required this.branchId,
    required this.ownerType,
    required this.ownerId,
    required this.status,
    required this.expiresAt,
    required this.version,
    required this.createdAt,
    required this.confirmedAt,
    required this.releasedAt,
    required this.expiredAt,
    required this.cancelledAt,
    required this.lineCount,
    required this.lines,
  });

  factory PosInventoryReservation.fromJson(Map<String, Object?> json) {
    final rawLines = json['lines'];
    return PosInventoryReservation(
      id: json['id']! as String,
      reservationNumber: json['reservation_number']! as String,
      branchId: json['branch_id']! as String,
      ownerType: json['owner_type']! as String,
      ownerId: json['owner_id']! as String,
      status: json['status']! as String,
      expiresAt: _optionalDate(json['expires_at']),
      version: _versionOf(json['version']),
      createdAt: DateTime.parse(json['created_at']! as String),
      confirmedAt: _optionalDate(json['confirmed_at']),
      releasedAt: _optionalDate(json['released_at']),
      expiredAt: _optionalDate(json['expired_at']),
      cancelledAt: _optionalDate(json['cancelled_at']),
      lineCount: json['line_count']! as int,
      lines: rawLines is List<Object?>
          ? rawLines.whereType<Map<String, Object?>>().map(PosInventoryReservationLine.fromJson).toList(growable: false)
          : const [],
    );
  }

  final String id;
  final String reservationNumber;
  final String branchId;

  /// `pos_cart` | `event` | `booking` | `order`.
  final String ownerType;
  final String ownerId;

  /// `active` | `confirmed` | `released` | `expired` | `cancelled`.
  final String status;
  final DateTime? expiresAt;
  final int version;
  final DateTime createdAt;
  final DateTime? confirmedAt;
  final DateTime? releasedAt;
  final DateTime? expiredAt;
  final DateTime? cancelledAt;
  final int lineCount;
  final List<PosInventoryReservationLine> lines;

  bool get isOpen => status == 'active' || status == 'confirmed';
}

class PosInventoryReservationPage {
  const PosInventoryReservationPage({required this.items, required this.nextCursor});
  final List<PosInventoryReservation> items;
  final String? nextCursor;
}

class PosInventoryReservationLineInput {
  const PosInventoryReservationLineInput({
    required this.locationId,
    required this.productVariantId,
    required this.quantity,
    required this.unitOfMeasureCode,
  });
  final String locationId;
  final String productVariantId;
  final String quantity;
  final String unitOfMeasureCode;

  Map<String, Object?> toJson() => {
    'location_id': locationId,
    'product_variant_id': productVariantId,
    'quantity': quantity,
    'unit_of_measure_code': unitOfMeasureCode,
  };
}

/// `POST /api/v1/inventory/reservations` body.
class PosInventoryReservationCreateInput {
  const PosInventoryReservationCreateInput({
    required this.branchId,
    required this.ownerType,
    required this.ownerId,
    required this.lines,
    this.expiresAt,
  });

  final String branchId;
  final String ownerType;
  final String ownerId;
  final List<PosInventoryReservationLineInput> lines;
  final String? expiresAt;

  Map<String, Object?> toJson() => {
    'branch_id': branchId,
    'owner_type': ownerType,
    'owner_id': ownerId,
    if (expiresAt != null) 'expires_at': expiresAt,
    'lines': lines.map((line) => line.toJson()).toList(growable: false),
  };
}

// ---------------------------------------------------------------------
// Ajustes/Reconciliación — reconciliation findings + repairs.
// `inventory-reconciliation.routes.ts`. Lifecycle: open (detector-created,
// never client-created) → acknowledged/dismissed (`inventory.reconcile`) or
// resolved (via a real two-step repair: preview then commit, BOTH
// `inventory.reconcile` AND `inventory.approve`).
// ---------------------------------------------------------------------

/// A `reconciliation finding` — `summary()`'s own fields always present;
/// `detail()`'s extra fields (evidence/fingerprint/lifecycle) are `null`
/// until fetched via [PosInventoryAdminGateway.finding].
class PosInventoryReconciliationFinding {
  const PosInventoryReconciliationFinding({
    required this.id,
    required this.findingType,
    required this.severity,
    required this.status,
    required this.branchId,
    required this.productVariantId,
    required this.firstDetectedAt,
    required this.lastDetectedAt,
    required this.occurrenceCount,
    required this.version,
    required this.expectedSummary,
    required this.actualSummary,
    required this.evidence,
    required this.fingerprint,
    required this.acknowledgedAt,
    required this.resolvedAt,
    required this.dismissedAt,
  });

  factory PosInventoryReconciliationFinding.fromJson(Map<String, Object?> json) {
    final scope = json['scope'] as Map<String, Object?>?;
    final lifecycle = json['lifecycle'] as Map<String, Object?>?;
    return PosInventoryReconciliationFinding(
      id: json['finding_id']! as String,
      findingType: json['finding_type']! as String,
      severity: json['severity']! as String,
      status: json['status']! as String,
      branchId: scope?['branch_id'] as String?,
      productVariantId: scope?['product_variant_id'] as String?,
      firstDetectedAt: DateTime.parse(json['first_detected_at']! as String),
      lastDetectedAt: DateTime.parse(json['last_detected_at']! as String),
      occurrenceCount: json['occurrence_count']! as int,
      version: _versionOf(json['version']),
      expectedSummary: json['expected_summary'] as Map<String, Object?>?,
      actualSummary: json['actual_summary'] as Map<String, Object?>?,
      evidence: json['evidence'] as Map<String, Object?>?,
      fingerprint: json['fingerprint'] as String?,
      acknowledgedAt: _optionalDate(lifecycle?['acknowledged_at']),
      resolvedAt: _optionalDate(lifecycle?['resolved_at']),
      dismissedAt: _optionalDate(lifecycle?['dismissed_at']),
    );
  }

  final String id;

  /// One of `findingTypes` in `inventory-reconciliation.routes.ts` (e.g.
  /// `balance_on_hand_drift`, `missing_balance`, `transfer_movement_mismatch`).
  final String findingType;

  /// `info` | `warning` | `critical`.
  final String severity;

  /// `open` | `acknowledged` | `resolved` | `dismissed`.
  final String status;
  final String? branchId;
  final String? productVariantId;
  final DateTime firstDetectedAt;
  final DateTime lastDetectedAt;
  final int occurrenceCount;
  final int version;
  final Map<String, Object?>? expectedSummary;
  final Map<String, Object?>? actualSummary;
  final Map<String, Object?>? evidence;
  final String? fingerprint;
  final DateTime? acknowledgedAt;
  final DateTime? resolvedAt;
  final DateTime? dismissedAt;

  bool get isOpen => status == 'open' || status == 'acknowledged';
}

class PosInventoryReconciliationFindingPage {
  const PosInventoryReconciliationFindingPage({required this.items, required this.nextCursor});
  final List<PosInventoryReconciliationFinding> items;
  final String? nextCursor;
}

/// `POST .../repair-previews` result — a real dry-run: [repairable]/
/// [warnings]/[proposedMutations] are exactly what the backend would apply,
/// never a client-side guess. [previewFingerprint]/[previewExpiresAt] MUST
/// be echoed back unchanged to `repair()` (`inventory-reconciliation
/// .routes.ts`'s own two-step preview→commit contract, preventing a repair
/// from applying to a finding that has since changed underneath it).
class PosInventoryRepairPreview {
  const PosInventoryRepairPreview({
    required this.findingId,
    required this.repairable,
    required this.strategy,
    required this.warnings,
    required this.previewFingerprint,
    required this.previewExpiresAt,
  });

  factory PosInventoryRepairPreview.fromJson(Map<String, Object?> json) => PosInventoryRepairPreview(
    findingId: json['finding_id']! as String,
    repairable: json['repairable']! as bool,
    strategy: json['strategy']! as String,
    warnings: (json['warnings'] as List<Object?>? ?? const []).whereType<String>().toList(growable: false),
    previewFingerprint: json['preview_fingerprint']! as String,
    previewExpiresAt: json['preview_expires_at']! as String,
  );

  final String findingId;
  final bool repairable;
  final String strategy;
  final List<String> warnings;
  final String previewFingerprint;

  /// A raw ISO-8601 timestamp string — kept exactly as returned (never
  /// re-parsed/re-formatted) since it is echoed back verbatim to
  /// [PosInventoryAdminGateway.repairFinding].
  final String previewExpiresAt;
}

// ---------------------------------------------------------------------
// The gateway.
// ---------------------------------------------------------------------

abstract interface class PosInventoryAdminGateway {
  // -- Ubicaciones ------------------------------------------------------

  /// `GET /api/v1/inventory/locations` (`inventory.read`).
  Future<PosInventoryLocationPage> listLocations({String? branchId, String? status, String? cursor, int limit = 50});

  /// `POST /api/v1/inventory/locations` (`inventory_location.manage`).
  Future<PosInventoryLocation> createLocation(PosInventoryLocationCreateInput input);

  /// `PATCH /api/v1/inventory/locations/{id}` (`inventory_location.manage`).
  Future<PosInventoryLocation> updateLocation(String id, PosInventoryLocationPatchInput input, {required int version});

  // -- Balances / Existencias ---------------------------------------------

  /// `GET /api/v1/inventory/balances` (`inventory.read`) — sources both the
  /// real variant/location picker for Movimientos/Traspasos/Conteos AND
  /// (TASK 16.7) the real Existencias screen: resolved product/variant/SKU/
  /// category/branch names, `min_stock` and the server-derived
  /// `stock_status` all come from this same authoritative query — never
  /// recomputed client-side.
  Future<PosInventoryBalancePage> listBalances({
    String? branchId,
    String? locationId,
    String? categoryId,
    String? search,
    String? stockStatus,
    String? cursor,
    int limit = 50,
  });

  /// `GET /api/v1/inventory/balances/export.csv` (`inventory.read`) — the
  /// real Existencias CSV export (TASK 16.7 §9), honoring the exact same
  /// tenant/branch/permission/filter contract as [listBalances].
  Future<String> exportBalancesCsv({String? branchId, String? locationId, String? categoryId, String? search, String? stockStatus});

  // -- Movimientos --------------------------------------------------------

  /// `GET /api/v1/inventory/movements` (`inventory.read`).
  Future<PosInventoryMovementPage> listMovements({
    String? branchId,
    String? status,
    String? type,
    String? cursor,
    int limit = 50,
  });

  /// `GET /api/v1/inventory/movements/{id}` (`inventory.read`).
  Future<PosInventoryMovement> movement(String id);

  /// `GET /api/v1/inventory/movements/{id}/lines` (`inventory.read`).
  Future<List<PosInventoryMovementLine>> movementLines(String id);

  /// `POST /api/v1/inventory/movements` (`inventory.adjust`).
  Future<PosInventoryMovement> createMovement(PosInventoryMovementHeaderInput input);

  /// `POST /api/v1/inventory/movements/{id}/lines` (`inventory.adjust`).
  Future<PosInventoryMovementLineResult> addMovementLine(String id, PosInventoryMovementLineInput input, {required int version});

  /// `DELETE /api/v1/inventory/movements/{id}/lines/{lineId}` (`inventory.adjust`).
  Future<PosInventoryMovementLineDeletion> deleteMovementLine(String id, String lineId, {required int version});

  /// `POST /api/v1/inventory/movements/{id}/submit` (`inventory.adjust`) —
  /// `draft` → `pending`.
  Future<PosInventoryMovementTransition> submitMovement(String id, {required int version});

  /// `POST /api/v1/inventory/movements/{id}/post` (`inventory.approve`) —
  /// `pending` → `posted`, applying the real ledger-affecting balance
  /// change.
  Future<PosInventoryMovementTransition> postMovement(String id, {required int version});

  /// `POST /api/v1/inventory/movements/{id}/cancel` (`inventory.adjust`) —
  /// a REQUIRED [reasonCode], mirroring the backend's own required field.
  Future<PosInventoryMovement> cancelMovement(String id, {required int version, required String reasonCode, String? note});

  /// `POST /api/v1/inventory/movements/{id}/reversals` (`inventory.reverse`)
  /// — only ever callable on a `posted` movement; a REQUIRED [reasonCode].
  Future<PosInventoryReversalResult> reverseMovement(String id, {required int version, required String reasonCode, String? note});

  // -- Traspasos ----------------------------------------------------------

  /// `GET /api/v1/inventory/transfers` (`inventory.read`).
  Future<PosInventoryTransferPage> listTransfers({String? status, String? branchId, String? cursor, int limit = 50});

  /// `GET /api/v1/inventory/transfers/{id}` (`inventory.read`).
  Future<PosInventoryTransfer> transfer(String id);

  /// `POST /api/v1/inventory/transfers` (`inventory.transfer`).
  Future<PosInventoryTransfer> createTransfer(PosInventoryTransferCreateInput input);

  /// `POST /api/v1/inventory/transfers/{id}/approvals` (`inventory.approve`)
  /// — [decision] is `approve` | `reject`.
  Future<PosInventoryTransfer> decideTransfer(
    String id, {
    required int version,
    required String decision,
    String? reasonCode,
    String? note,
  });

  /// `POST /api/v1/inventory/transfers/{id}/shipments` (`inventory.transfer`).
  Future<PosInventoryTransfer> shipTransfer(String id, {required int version, String? note});

  /// `POST /api/v1/inventory/transfers/{id}/receipts` (`inventory.receive`)
  /// — the receive-confirmation action.
  Future<PosInventoryTransfer> receiveTransfer(String id, {required int version, String? note});

  /// `POST /api/v1/inventory/transfers/{id}/cancellations` (`inventory.transfer`).
  Future<PosInventoryTransfer> cancelTransfer(String id, {required int version, required String reasonCode, String? note});

  // -- Conteos --------------------------------------------------------------

  /// `GET /api/v1/inventory/counts` (`inventory.read`).
  Future<PosInventoryCountPage> listCounts({String? branchId, String? status, String? cursor, int limit = 50});

  /// `GET /api/v1/inventory/counts/{id}` (`inventory.read`).
  Future<PosInventoryCount> count(String id);

  /// `POST /api/v1/inventory/counts` (`inventory.count`) — a REQUIRED
  /// [PosInventoryCountCreateInput.reasonCode].
  Future<PosInventoryCount> createCount(PosInventoryCountCreateInput input);

  /// `POST /api/v1/inventory/counts/{id}/starts` (`inventory.count`) —
  /// `draft` → `counting`, snapshotting expected quantities for the scope.
  Future<PosInventoryCount> startCount(String id, {required int version});

  /// `PUT /api/v1/inventory/counts/{id}/lines/{variantId}` (`inventory.count`).
  Future<PosInventoryCountLine> recordCountLine(
    String id,
    String productVariantId, {
    required String countedQuantity,
    required String unitOfMeasureCode,
    required int version,
  });

  /// `POST /api/v1/inventory/counts/{id}/submissions` (`inventory.count`) —
  /// `counting` → `submitted`.
  Future<PosInventoryCount> submitCount(String id, {required int version});

  /// `POST /api/v1/inventory/counts/{id}/approvals` (`inventory.approve`) —
  /// `submitted` → `approved`.
  Future<PosInventoryCount> approveCount(String id, {required int version});

  /// `POST /api/v1/inventory/counts/{id}/applications` (`inventory.approve`)
  /// — `approved` → `applied`, posting the real adjusting movement.
  Future<PosInventoryCount> applyCount(String id, {required int version});

  /// `POST /api/v1/inventory/counts/{id}/cancellations` (`inventory.count`).
  Future<PosInventoryCount> cancelCount(String id, {required int version, required String reasonCode, String? note});

  // -- Reservas ---------------------------------------------------------

  /// `GET /api/v1/inventory/reservations` (`inventory.read`).
  Future<PosInventoryReservationPage> listReservations({String? branchId, String? status, String? cursor, int limit = 50});

  /// `GET /api/v1/inventory/reservations/{id}` (`inventory.read`).
  Future<PosInventoryReservation> reservation(String id);

  /// `POST /api/v1/inventory/reservations` (`inventory.reservation.manage`).
  Future<PosInventoryReservation> createReservation(PosInventoryReservationCreateInput input);

  /// `POST /api/v1/inventory/reservations/{id}/confirmations`
  /// (`inventory.reservation.manage`).
  Future<PosInventoryReservation> confirmReservation(String id, {required int version});

  /// `POST /api/v1/inventory/reservations/{id}/releases`
  /// (`inventory.reservation.manage`) — [action] is `release` | `expire` |
  /// `cancel`; a REQUIRED [reasonCode].
  Future<PosInventoryReservation> releaseReservation(
    String id, {
    required int version,
    required String action,
    required String reasonCode,
    String? note,
  });

  // -- Ajustes/Reconciliación --------------------------------------------

  /// `GET /api/v1/inventory/reconciliation/findings` (`inventory.reconcile`).
  Future<PosInventoryReconciliationFindingPage> listFindings({
    String? status,
    String? severity,
    String? branchId,
    String? cursor,
    int limit = 50,
  });

  /// `GET /api/v1/inventory/reconciliation/findings/{id}` (`inventory.reconcile`).
  Future<PosInventoryReconciliationFinding> finding(String id);

  /// `POST .../findings/{id}/acknowledgements` (`inventory.reconcile`) — a
  /// REQUIRED [reasonCode].
  Future<PosInventoryReconciliationFinding> acknowledgeFinding(String id, {required int version, required String reasonCode, String? note});

  /// `POST .../findings/{id}/dismissals` (`inventory.reconcile`) — a
  /// REQUIRED [reasonCode].
  Future<PosInventoryReconciliationFinding> dismissFinding(String id, {required int version, required String reasonCode, String? note});

  /// `POST .../findings/{id}/repair-previews` (`inventory.reconcile`) —
  /// step 1 of the real two-step repair; [expectedFingerprint] is the
  /// finding's own already-fetched `fingerprint`.
  Future<PosInventoryRepairPreview> previewRepair(
    String id, {
    required int version,
    required String strategy,
    required String expectedFingerprint,
  });

  /// `POST .../findings/{id}/repairs` (`inventory.reconcile` AND
  /// `inventory.approve` — the backend requires BOTH) — step 2, committing
  /// the exact preview via its own [previewFingerprint]/[previewExpiresAt].
  /// A REQUIRED [reasonCode].
  Future<PosInventoryReconciliationFinding> repairFinding(
    String id, {
    required int version,
    required String strategy,
    required String expectedFingerprint,
    required String previewFingerprint,
    required String previewExpiresAt,
    required String reasonCode,
    String? note,
  });
}

class ApiPosInventoryAdminGateway implements PosInventoryAdminGateway {
  const ApiPosInventoryAdminGateway(this._client);
  final ApiClient _client;

  // -- Ubicaciones --------------------------------------------------------

  @override
  Future<PosInventoryLocationPage> listLocations({String? branchId, String? status, String? cursor, int limit = 50}) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (branchId != null) 'branch_id': branchId,
      if (status != null) 'status': status,
    };
    final envelope = await _client.getJson(Uri(path: '/api/v1/inventory/locations', queryParameters: query).toString());
    final page = _page(envelope, 'locations');
    return PosInventoryLocationPage(
      items: page.items.map(PosInventoryLocation.fromJson).toList(growable: false),
      nextCursor: page.nextCursor,
    );
  }

  @override
  Future<PosInventoryLocation> createLocation(PosInventoryLocationCreateInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/locations',
      idempotencyKey: _idempotencyKey('location'),
      body: input.toJson(),
    );
    return PosInventoryLocation.fromJson(_single(envelope, 'location'));
  }

  @override
  Future<PosInventoryLocation> updateLocation(String id, PosInventoryLocationPatchInput input, {required int version}) async {
    final envelope = await _client.patchJson('/api/v1/inventory/locations/$id', ifMatch: '"$version"', body: input.toJson());
    return PosInventoryLocation.fromJson(_single(envelope, 'location'));
  }

  // -- Balances -------------------------------------------------------------

  @override
  Future<PosInventoryBalancePage> listBalances({
    String? branchId,
    String? locationId,
    String? categoryId,
    String? search,
    String? stockStatus,
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (branchId != null) 'branch_id': branchId,
      if (locationId != null) 'location_id': locationId,
      if (categoryId != null) 'category_id': categoryId,
      if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
      if (stockStatus != null) 'stock_status': stockStatus,
    };
    final envelope = await _client.getJson(Uri(path: '/api/v1/inventory/balances', queryParameters: query).toString());
    final page = _page(envelope, 'balances');
    return PosInventoryBalancePage(
      items: page.items.map(PosInventoryBalance.fromJson).toList(growable: false),
      nextCursor: page.nextCursor,
    );
  }

  @override
  Future<String> exportBalancesCsv({String? branchId, String? locationId, String? categoryId, String? search, String? stockStatus}) {
    final query = <String, String>{
      if (branchId != null) 'branch_id': branchId,
      if (locationId != null) 'location_id': locationId,
      if (categoryId != null) 'category_id': categoryId,
      if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
      if (stockStatus != null) 'stock_status': stockStatus,
    };
    return _client.getText(Uri(path: '/api/v1/inventory/balances/export.csv', queryParameters: query).toString());
  }

  // -- Movimientos ----------------------------------------------------------

  @override
  Future<PosInventoryMovementPage> listMovements({String? branchId, String? status, String? type, String? cursor, int limit = 50}) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (branchId != null) 'branch_id': branchId,
      if (status != null) 'status': status,
      if (type != null) 'type': type,
    };
    final envelope = await _client.getJson(Uri(path: '/api/v1/inventory/movements', queryParameters: query).toString());
    final page = _page(envelope, 'movements');
    return PosInventoryMovementPage(
      items: page.items.map(PosInventoryMovement.fromJson).toList(growable: false),
      nextCursor: page.nextCursor,
    );
  }

  @override
  Future<PosInventoryMovement> movement(String id) async {
    final envelope = await _client.getJson('/api/v1/inventory/movements/$id');
    return PosInventoryMovement.fromJson(_single(envelope, 'movement'));
  }

  @override
  Future<List<PosInventoryMovementLine>> movementLines(String id) async {
    final envelope = await _client.getJson('/api/v1/inventory/movements/$id/lines');
    final data = envelope['data'];
    if (data is! List<Object?>) {
      throw const FormatException('Missing movement lines data.');
    }
    return data.whereType<Map<String, Object?>>().map(PosInventoryMovementLine.fromJson).toList(growable: false);
  }

  @override
  Future<PosInventoryMovement> createMovement(PosInventoryMovementHeaderInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/movements',
      idempotencyKey: _idempotencyKey('movement'),
      body: input.toJson(),
    );
    return PosInventoryMovement.fromJson(_single(envelope, 'movement'));
  }

  @override
  Future<PosInventoryMovementLineResult> addMovementLine(String id, PosInventoryMovementLineInput input, {required int version}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/movements/$id/lines',
      idempotencyKey: _idempotencyKey('movement-line'),
      ifMatch: '"$version"',
      body: input.toJson(),
    );
    final data = _single(envelope, 'movement line');
    return PosInventoryMovementLineResult(
      line: PosInventoryMovementLine.fromJson(data['line']! as Map<String, Object?>),
      version: _versionOf(data['version']),
    );
  }

  @override
  Future<PosInventoryMovementLineDeletion> deleteMovementLine(String id, String lineId, {required int version}) async {
    final envelope = await _client.deleteJson('/api/v1/inventory/movements/$id/lines/$lineId', ifMatch: '"$version"');
    final data = _single(envelope, 'movement line deletion');
    return PosInventoryMovementLineDeletion(
      movementId: data['movement_id']! as String,
      deletedLineId: data['deleted_line_id']! as String,
      version: _versionOf(data['version']),
    );
  }

  @override
  Future<PosInventoryMovementTransition> submitMovement(String id, {required int version}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/movements/$id/submit',
      idempotencyKey: _idempotencyKey('submit'),
      ifMatch: '"$version"',
      omitBody: true,
    );
    return PosInventoryMovementTransition.fromJson(_single(envelope, 'movement submission'));
  }

  @override
  Future<PosInventoryMovementTransition> postMovement(String id, {required int version}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/movements/$id/post',
      idempotencyKey: _idempotencyKey('post'),
      ifMatch: '"$version"',
      omitBody: true,
    );
    return PosInventoryMovementTransition.fromJson(_single(envelope, 'movement posting'));
  }

  @override
  Future<PosInventoryMovement> cancelMovement(String id, {required int version, required String reasonCode, String? note}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/movements/$id/cancel',
      idempotencyKey: _idempotencyKey('cancel'),
      ifMatch: '"$version"',
      body: {'reason_code': reasonCode, if (note != null) 'note': note},
    );
    return PosInventoryMovement.fromJson(_single(envelope, 'movement cancellation'));
  }

  @override
  Future<PosInventoryReversalResult> reverseMovement(String id, {required int version, required String reasonCode, String? note}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/movements/$id/reversals',
      idempotencyKey: _idempotencyKey('reversal'),
      ifMatch: '"$version"',
      body: {'reason_code': reasonCode, if (note != null) 'note': note},
    );
    return PosInventoryReversalResult.fromJson(_single(envelope, 'movement reversal'));
  }

  // -- Traspasos --------------------------------------------------------------

  @override
  Future<PosInventoryTransferPage> listTransfers({String? status, String? branchId, String? cursor, int limit = 50}) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (status != null) 'status': status,
      if (branchId != null) 'branch_id': branchId,
    };
    final envelope = await _client.getJson(Uri(path: '/api/v1/inventory/transfers', queryParameters: query).toString());
    final page = _page(envelope, 'transfers');
    return PosInventoryTransferPage(
      items: page.items.map(PosInventoryTransfer.fromJson).toList(growable: false),
      nextCursor: page.nextCursor,
    );
  }

  @override
  Future<PosInventoryTransfer> transfer(String id) async {
    final envelope = await _client.getJson('/api/v1/inventory/transfers/$id');
    return PosInventoryTransfer.fromJson(_single(envelope, 'transfer'));
  }

  @override
  Future<PosInventoryTransfer> createTransfer(PosInventoryTransferCreateInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/transfers',
      idempotencyKey: _idempotencyKey('transfer'),
      body: input.toJson(),
    );
    return PosInventoryTransfer.fromJson(_single(envelope, 'transfer'));
  }

  @override
  Future<PosInventoryTransfer> decideTransfer(
    String id, {
    required int version,
    required String decision,
    String? reasonCode,
    String? note,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/transfers/$id/approvals',
      idempotencyKey: _idempotencyKey('transfer-decision'),
      ifMatch: '"$version"',
      body: {'decision': decision, if (reasonCode != null) 'reason_code': reasonCode, if (note != null) 'note': note},
    );
    return PosInventoryTransfer.fromJson(_single(envelope, 'transfer decision'));
  }

  @override
  Future<PosInventoryTransfer> shipTransfer(String id, {required int version, String? note}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/transfers/$id/shipments',
      idempotencyKey: _idempotencyKey('transfer-ship'),
      ifMatch: '"$version"',
      body: {if (note != null) 'note': note},
    );
    return PosInventoryTransfer.fromJson(_single(envelope, 'transfer shipment'));
  }

  @override
  Future<PosInventoryTransfer> receiveTransfer(String id, {required int version, String? note}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/transfers/$id/receipts',
      idempotencyKey: _idempotencyKey('transfer-receive'),
      ifMatch: '"$version"',
      body: {if (note != null) 'note': note},
    );
    return PosInventoryTransfer.fromJson(_single(envelope, 'transfer receipt'));
  }

  @override
  Future<PosInventoryTransfer> cancelTransfer(String id, {required int version, required String reasonCode, String? note}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/transfers/$id/cancellations',
      idempotencyKey: _idempotencyKey('transfer-cancel'),
      ifMatch: '"$version"',
      body: {'reason_code': reasonCode, if (note != null) 'note': note},
    );
    return PosInventoryTransfer.fromJson(_single(envelope, 'transfer cancellation'));
  }

  // -- Conteos ------------------------------------------------------------

  @override
  Future<PosInventoryCountPage> listCounts({String? branchId, String? status, String? cursor, int limit = 50}) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (branchId != null) 'branch_id': branchId,
      if (status != null) 'status': status,
    };
    final envelope = await _client.getJson(Uri(path: '/api/v1/inventory/counts', queryParameters: query).toString());
    final page = _page(envelope, 'counts');
    return PosInventoryCountPage(
      items: page.items.map(PosInventoryCount.fromJson).toList(growable: false),
      nextCursor: page.nextCursor,
    );
  }

  @override
  Future<PosInventoryCount> count(String id) async {
    final envelope = await _client.getJson('/api/v1/inventory/counts/$id');
    return PosInventoryCount.fromJson(_single(envelope, 'count'));
  }

  @override
  Future<PosInventoryCount> createCount(PosInventoryCountCreateInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/counts',
      idempotencyKey: _idempotencyKey('count'),
      body: input.toJson(),
    );
    return PosInventoryCount.fromJson(_single(envelope, 'count'));
  }

  @override
  Future<PosInventoryCount> startCount(String id, {required int version}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/counts/$id/starts',
      idempotencyKey: _idempotencyKey('count-start'),
      ifMatch: '"$version"',
      body: const {},
    );
    return PosInventoryCount.fromJson(_single(envelope, 'count start'));
  }

  @override
  Future<PosInventoryCountLine> recordCountLine(
    String id,
    String productVariantId, {
    required String countedQuantity,
    required String unitOfMeasureCode,
    required int version,
  }) async {
    final envelope = await _client.putJson(
      '/api/v1/inventory/counts/$id/lines/$productVariantId',
      ifMatch: '"$version"',
      body: {'counted_quantity': countedQuantity, 'unit_of_measure_code': unitOfMeasureCode},
    );
    return PosInventoryCountLine.fromJson(_single(envelope, 'count line'));
  }

  @override
  Future<PosInventoryCount> submitCount(String id, {required int version}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/counts/$id/submissions',
      idempotencyKey: _idempotencyKey('count-submit'),
      ifMatch: '"$version"',
      body: const {},
    );
    return PosInventoryCount.fromJson(_single(envelope, 'count submission'));
  }

  @override
  Future<PosInventoryCount> approveCount(String id, {required int version}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/counts/$id/approvals',
      idempotencyKey: _idempotencyKey('count-approve'),
      ifMatch: '"$version"',
      body: const {},
    );
    return PosInventoryCount.fromJson(_single(envelope, 'count approval'));
  }

  @override
  Future<PosInventoryCount> applyCount(String id, {required int version}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/counts/$id/applications',
      idempotencyKey: _idempotencyKey('count-apply'),
      ifMatch: '"$version"',
      body: const {},
    );
    return PosInventoryCount.fromJson(_single(envelope, 'count application'));
  }

  @override
  Future<PosInventoryCount> cancelCount(String id, {required int version, required String reasonCode, String? note}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/counts/$id/cancellations',
      idempotencyKey: _idempotencyKey('count-cancel'),
      ifMatch: '"$version"',
      body: {'reason_code': reasonCode, if (note != null) 'note': note},
    );
    return PosInventoryCount.fromJson(_single(envelope, 'count cancellation'));
  }

  // -- Reservas -------------------------------------------------------------

  @override
  Future<PosInventoryReservationPage> listReservations({String? branchId, String? status, String? cursor, int limit = 50}) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (branchId != null) 'branch_id': branchId,
      if (status != null) 'status': status,
    };
    final envelope = await _client.getJson(Uri(path: '/api/v1/inventory/reservations', queryParameters: query).toString());
    final page = _page(envelope, 'reservations');
    return PosInventoryReservationPage(
      items: page.items.map(PosInventoryReservation.fromJson).toList(growable: false),
      nextCursor: page.nextCursor,
    );
  }

  @override
  Future<PosInventoryReservation> reservation(String id) async {
    final envelope = await _client.getJson('/api/v1/inventory/reservations/$id');
    return PosInventoryReservation.fromJson(_single(envelope, 'reservation'));
  }

  @override
  Future<PosInventoryReservation> createReservation(PosInventoryReservationCreateInput input) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/reservations',
      idempotencyKey: _idempotencyKey('reservation'),
      body: input.toJson(),
    );
    return PosInventoryReservation.fromJson(_single(envelope, 'reservation'));
  }

  @override
  Future<PosInventoryReservation> confirmReservation(String id, {required int version}) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/reservations/$id/confirmations',
      idempotencyKey: _idempotencyKey('reservation-confirm'),
      ifMatch: '"$version"',
      body: const {},
    );
    return PosInventoryReservation.fromJson(_single(envelope, 'reservation confirmation'));
  }

  @override
  Future<PosInventoryReservation> releaseReservation(
    String id, {
    required int version,
    required String action,
    required String reasonCode,
    String? note,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/reservations/$id/releases',
      idempotencyKey: _idempotencyKey('reservation-release'),
      ifMatch: '"$version"',
      body: {'action': action, 'reason_code': reasonCode, if (note != null) 'note': note},
    );
    return PosInventoryReservation.fromJson(_single(envelope, 'reservation release'));
  }

  // -- Ajustes/Reconciliación ----------------------------------------------

  @override
  Future<PosInventoryReconciliationFindingPage> listFindings({
    String? status,
    String? severity,
    String? branchId,
    String? cursor,
    int limit = 50,
  }) async {
    final query = <String, String>{
      'limit': '$limit',
      if (cursor != null) 'cursor': cursor,
      if (status != null) 'status': status,
      if (severity != null) 'severity': severity,
      if (branchId != null) 'branch_id': branchId,
    };
    final envelope = await _client.getJson(
      Uri(path: '/api/v1/inventory/reconciliation/findings', queryParameters: query).toString(),
    );
    final page = _page(envelope, 'findings');
    return PosInventoryReconciliationFindingPage(
      items: page.items.map(PosInventoryReconciliationFinding.fromJson).toList(growable: false),
      nextCursor: page.nextCursor,
    );
  }

  @override
  Future<PosInventoryReconciliationFinding> finding(String id) async {
    final envelope = await _client.getJson('/api/v1/inventory/reconciliation/findings/$id');
    return PosInventoryReconciliationFinding.fromJson(_single(envelope, 'finding'));
  }

  @override
  Future<PosInventoryReconciliationFinding> acknowledgeFinding(
    String id, {
    required int version,
    required String reasonCode,
    String? note,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/reconciliation/findings/$id/acknowledgements',
      idempotencyKey: _idempotencyKey('finding-ack'),
      ifMatch: '"$version"',
      body: {'reason_code': reasonCode, if (note != null) 'note': note},
    );
    return PosInventoryReconciliationFinding.fromJson(_single(envelope, 'finding acknowledgement'));
  }

  @override
  Future<PosInventoryReconciliationFinding> dismissFinding(
    String id, {
    required int version,
    required String reasonCode,
    String? note,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/reconciliation/findings/$id/dismissals',
      idempotencyKey: _idempotencyKey('finding-dismiss'),
      ifMatch: '"$version"',
      body: {'reason_code': reasonCode, if (note != null) 'note': note},
    );
    return PosInventoryReconciliationFinding.fromJson(_single(envelope, 'finding dismissal'));
  }

  @override
  Future<PosInventoryRepairPreview> previewRepair(
    String id, {
    required int version,
    required String strategy,
    required String expectedFingerprint,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/reconciliation/findings/$id/repair-previews',
      ifMatch: '"$version"',
      body: {'strategy': strategy, 'expected_fingerprint': expectedFingerprint},
    );
    return PosInventoryRepairPreview.fromJson(_single(envelope, 'repair preview'));
  }

  @override
  Future<PosInventoryReconciliationFinding> repairFinding(
    String id, {
    required int version,
    required String strategy,
    required String expectedFingerprint,
    required String previewFingerprint,
    required String previewExpiresAt,
    required String reasonCode,
    String? note,
  }) async {
    final envelope = await _client.postJson(
      '/api/v1/inventory/reconciliation/findings/$id/repairs',
      idempotencyKey: _idempotencyKey('finding-repair'),
      ifMatch: '"$version"',
      body: {
        'strategy': strategy,
        'expected_fingerprint': expectedFingerprint,
        'preview_fingerprint': previewFingerprint,
        'preview_expires_at': previewExpiresAt,
        'reason_code': reasonCode,
        if (note != null) 'note': note,
      },
    );
    return PosInventoryReconciliationFinding.fromJson(_single(envelope, 'finding repair'));
  }
}

class EmptyPosInventoryAdminGateway implements PosInventoryAdminGateway {
  const EmptyPosInventoryAdminGateway();

  @override
  Future<PosInventoryLocationPage> listLocations({String? branchId, String? status, String? cursor, int limit = 50}) async =>
      const PosInventoryLocationPage(items: [], nextCursor: null);
  @override
  Future<PosInventoryLocation> createLocation(PosInventoryLocationCreateInput input) => Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryLocation> updateLocation(String id, PosInventoryLocationPatchInput input, {required int version}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));

  @override
  Future<PosInventoryBalancePage> listBalances({
    String? branchId,
    String? locationId,
    String? categoryId,
    String? search,
    String? stockStatus,
    String? cursor,
    int limit = 50,
  }) async => const PosInventoryBalancePage(items: [], nextCursor: null);

  @override
  Future<String> exportBalancesCsv({String? branchId, String? locationId, String? categoryId, String? search, String? stockStatus}) async => '';

  @override
  Future<PosInventoryMovementPage> listMovements({String? branchId, String? status, String? type, String? cursor, int limit = 50}) async =>
      const PosInventoryMovementPage(items: [], nextCursor: null);
  @override
  Future<PosInventoryMovement> movement(String id) => Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<List<PosInventoryMovementLine>> movementLines(String id) async => const [];
  @override
  Future<PosInventoryMovement> createMovement(PosInventoryMovementHeaderInput input) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryMovementLineResult> addMovementLine(String id, PosInventoryMovementLineInput input, {required int version}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryMovementLineDeletion> deleteMovementLine(String id, String lineId, {required int version}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryMovementTransition> submitMovement(String id, {required int version}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryMovementTransition> postMovement(String id, {required int version}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryMovement> cancelMovement(String id, {required int version, required String reasonCode, String? note}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryReversalResult> reverseMovement(String id, {required int version, required String reasonCode, String? note}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));

  @override
  Future<PosInventoryTransferPage> listTransfers({String? status, String? branchId, String? cursor, int limit = 50}) async =>
      const PosInventoryTransferPage(items: [], nextCursor: null);
  @override
  Future<PosInventoryTransfer> transfer(String id) => Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryTransfer> createTransfer(PosInventoryTransferCreateInput input) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryTransfer> decideTransfer(String id, {required int version, required String decision, String? reasonCode, String? note}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryTransfer> shipTransfer(String id, {required int version, String? note}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryTransfer> receiveTransfer(String id, {required int version, String? note}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryTransfer> cancelTransfer(String id, {required int version, required String reasonCode, String? note}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));

  @override
  Future<PosInventoryCountPage> listCounts({String? branchId, String? status, String? cursor, int limit = 50}) async =>
      const PosInventoryCountPage(items: [], nextCursor: null);
  @override
  Future<PosInventoryCount> count(String id) => Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryCount> createCount(PosInventoryCountCreateInput input) => Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryCount> startCount(String id, {required int version}) => Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryCountLine> recordCountLine(
    String id,
    String productVariantId, {
    required String countedQuantity,
    required String unitOfMeasureCode,
    required int version,
  }) => Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryCount> submitCount(String id, {required int version}) => Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryCount> approveCount(String id, {required int version}) => Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryCount> applyCount(String id, {required int version}) => Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryCount> cancelCount(String id, {required int version, required String reasonCode, String? note}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));

  @override
  Future<PosInventoryReservationPage> listReservations({String? branchId, String? status, String? cursor, int limit = 50}) async =>
      const PosInventoryReservationPage(items: [], nextCursor: null);
  @override
  Future<PosInventoryReservation> reservation(String id) => Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryReservation> createReservation(PosInventoryReservationCreateInput input) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryReservation> confirmReservation(String id, {required int version}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryReservation> releaseReservation(
    String id, {
    required int version,
    required String action,
    required String reasonCode,
    String? note,
  }) => Future.error(StateError('No inventory admin gateway is configured.'));

  @override
  Future<PosInventoryReconciliationFindingPage> listFindings({
    String? status,
    String? severity,
    String? branchId,
    String? cursor,
    int limit = 50,
  }) async => const PosInventoryReconciliationFindingPage(items: [], nextCursor: null);
  @override
  Future<PosInventoryReconciliationFinding> finding(String id) => Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryReconciliationFinding> acknowledgeFinding(String id, {required int version, required String reasonCode, String? note}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryReconciliationFinding> dismissFinding(String id, {required int version, required String reasonCode, String? note}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryRepairPreview> previewRepair(String id, {required int version, required String strategy, required String expectedFingerprint}) =>
      Future.error(StateError('No inventory admin gateway is configured.'));
  @override
  Future<PosInventoryReconciliationFinding> repairFinding(
    String id, {
    required int version,
    required String strategy,
    required String expectedFingerprint,
    required String previewFingerprint,
    required String previewExpiresAt,
    required String reasonCode,
    String? note,
  }) => Future.error(StateError('No inventory admin gateway is configured.'));
}
