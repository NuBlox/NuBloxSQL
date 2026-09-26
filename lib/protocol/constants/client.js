// MySQL client capability flags used by the classic protocol.
exports.CLIENT_LONG_PASSWORD     = 1;
exports.CLIENT_FOUND_ROWS        = 2;
exports.CLIENT_LONG_FLAG         = 4;
exports.CLIENT_CONNECT_WITH_DB   = 8;
exports.CLIENT_NO_SCHEMA         = 16;
exports.CLIENT_COMPRESS          = 32;
exports.CLIENT_ODBC              = 64;
exports.CLIENT_LOCAL_FILES       = 128;
exports.CLIENT_IGNORE_SPACE      = 256;
exports.CLIENT_PROTOCOL_41       = 512;
exports.CLIENT_INTERACTIVE       = 1024;
exports.CLIENT_SSL               = 2048;
exports.CLIENT_IGNORE_SIGPIPE    = 4096;
exports.CLIENT_TRANSACTIONS      = 8192;
exports.CLIENT_RESERVED          = 16384;
exports.CLIENT_SECURE_CONNECTION = 32768;

exports.CLIENT_MULTI_STATEMENTS = 65536;
exports.CLIENT_MULTI_RESULTS    = 131072;
exports.CLIENT_PS_MULTI_RESULTS = 262144;
exports.CLIENT_PLUGIN_AUTH      = 524288;
exports.CLIENT_CONNECT_ATTRS    = 1048576;
exports.CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA = 2097152;
exports.CLIENT_CAN_HANDLE_EXPIRED_PASSWORDS   = 4194304;
exports.CLIENT_SESSION_TRACK                  = 8388608;
exports.CLIENT_DEPRECATE_EOF                  = 16777216;

exports.CLIENT_SSL_VERIFY_SERVER_CERT = 1073741824;
exports.CLIENT_REMEMBER_OPTIONS       = 2147483648;
