module.exports = BufferList;
function BufferList() {
  this.bufs = [];
  this.size = 0;
  this._head = 0;
}

BufferList.prototype.shift = function shift() {
  if (this._head >= this.bufs.length) {
    return undefined;
  }

  var buf = this.bufs[this._head++];
  this.size -= buf.length;

  if (this._head === this.bufs.length) {
    this.bufs = [];
    this._head = 0;
  } else if (this._head >= 1024 && this._head * 2 >= this.bufs.length) {
    this.bufs = this.bufs.slice(this._head);
    this._head = 0;
  }

  return buf;
};

BufferList.prototype.push = function push(buf) {
  if (!buf || !buf.length) {
    return;
  }

  this.bufs.push(buf);
  this.size += buf.length;
};
