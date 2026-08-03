import 'package:http/http.dart' as http;

import 'http_client_factory_stub.dart'
    if (dart.library.js_interop) 'http_client_factory_web.dart'
    as platform;

http.Client createPlatformHttpClient() => platform.createPlatformHttpClient();
