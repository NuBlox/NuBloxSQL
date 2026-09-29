'use strict';

function withoutStreamControl(options) {
  var out = Object.assign({}, options || {});
  delete out.batchSize;
  delete out.acquire;
  return out;
}

function install(streamApi) {
  var RowStream = streamApi && streamApi.ClientRowStream;
  if (!RowStream || !RowStream.prototype || RowStream.prototype._nubloxSqlServerStreaming) return;
  var original = RowStream.prototype._initialize;
  Object.defineProperty(RowStream.prototype, '_nubloxSqlServerStreaming', { value: true });
  RowStream.prototype._initialize = async function initializeWithSqlServer() {
    if (this.dialect !== 'sqlserver') return original.call(this);
    var connection = await this._acquireConnection();
    var nativeOptions = withoutStreamControl(this.options);
    if (this.compiled.parameters.length) {
      this.native = connection.queryParametersStream(this.compiled.text, this.compiled.parameters, nativeOptions);
    } else {
      this.native = connection.queryStream(this.compiled.text, nativeOptions);
    }
    this._iterator = this.native[Symbol.asyncIterator]();
  };
}

exports.install = install;
