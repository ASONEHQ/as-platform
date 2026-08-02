/// Intentionally memory-only. Browser refresh credentials remain HttpOnly cookies.
class MemoryTokenVault {
  String? _accessToken;
  String? get accessToken => _accessToken;
  void replace(String? value) => _accessToken = value;
  void clear() => _accessToken = null;
}
