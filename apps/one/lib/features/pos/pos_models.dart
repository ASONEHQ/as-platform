class PosProduct {
  const PosProduct({
    required this.id,
    required this.code,
    required this.name,
    required this.type,
    required this.status,
    required this.tracksInventory,
    this.categoryId,
    this.defaultVariantId,
  });

  factory PosProduct.fromJson(Map<String, Object?> json) => PosProduct(
    id: json.string('id'),
    code: json.string('code'),
    name: json.string('name'),
    type: json.string('product_type'),
    status: json.string('status'),
    tracksInventory: json['tracks_inventory'] == true,
    categoryId: json['category_id'] as String?,
    // The products list endpoint does not expand `default_variant`; this is
    // only ever populated when a future projection includes it (see
    // docs/AS_POS_READ_ONLY_SHELL.md, "Read-only limitations").
    defaultVariantId: switch (json['default_variant']) {
      final Map<String, Object?> variant => variant['id'] as String?,
      _ => null,
    },
  );

  final String id;
  final String code;
  final String name;
  final String type;
  final String status;
  final bool tracksInventory;
  final String? categoryId;
  final String? defaultVariantId;
}

class PosCategory {
  const PosCategory({required this.id, required this.name, required this.status});

  factory PosCategory.fromJson(Map<String, Object?> json) => PosCategory(
    id: json.string('id'),
    name: json.string('name'),
    status: json.string('status'),
  );

  final String id;
  final String name;
  final String status;
}

class PosInventoryBalance {
  const PosInventoryBalance({
    required this.id,
    required this.branchId,
    required this.locationId,
    required this.variantId,
    required this.onHand,
    required this.reserved,
    required this.inTransit,
  });

  factory PosInventoryBalance.fromJson(Map<String, Object?> json) =>
      PosInventoryBalance(
        id: json.string('id'),
        branchId: json.string('branch_id'),
        locationId: json.string('inventory_location_id'),
        variantId: json.string('product_variant_id'),
        onHand: json.string('quantity_on_hand'),
        reserved: json.string('quantity_reserved'),
        inTransit: json.string('quantity_in_transit'),
      );

  final String id;
  final String branchId;
  final String locationId;
  final String variantId;
  final String onHand;
  final String reserved;
  final String inTransit;
}

class PosUser {
  const PosUser({
    required this.id,
    required this.email,
    required this.displayName,
    required this.identityStatus,
    required this.membershipStatus,
  });

  factory PosUser.fromJson(Map<String, Object?> json) => PosUser(
    id: json.string('id'),
    email: json.string('email'),
    displayName: json.string('display_name'),
    identityStatus: json.string('identity_status'),
    membershipStatus: json.string('membership_status'),
  );

  final String id;
  final String email;
  final String displayName;
  final String identityStatus;
  final String membershipStatus;
}

extension on Map<String, Object?> {
  String string(String key) {
    final value = this[key];
    if (value is! String) throw FormatException('Missing $key.');
    return value;
  }
}
