
const FLIPPER_PROTO_FILES = [
  "assets/proto/flipper.proto",
  "assets/proto/storage.proto",
  "assets/proto/system.proto",
  "assets/proto/application.proto",
  "assets/proto/gui.proto",
  "assets/proto/gpio.proto",
  "assets/proto/property.proto",
  "assets/proto/desktop.proto",
];
const FLIPPER_WRITE_CHUNK_SIZE = 512;
const FLIPPER_VID = 0x0483;

class FlipperRPC {
  constructor(opts = {}) {
    this.onLog = opts.onLog || function () {};
    this.onScreenFrame = opts.onScreenFrame || null;
    this.onDesktopStatus = opts.onDesktopStatus || null;
    this.onConnectionLost = opts.onConnectionLost || function () {};
    this.onReconnected = opts.onReconnected || function () {};
    this.autoReconnect = opts.autoReconnect !== false;

    this.root = null;
    this.MainType = null;
    this.port = null;
    this.writer = null;
    this.reader = null;
    this.readLoopPromise = null;
    this.connected = false;
    this.cliMode = false;
    this.virtualDisplayActive = false;
    this.screenStreamActive = false;
    this.nextCommandId = 1;
    this.pending = new Map();
    this.rxBuffer = new Uint8Array(0);
    this.onCliLine = null;
    this.cliLineBuffer = "";

    this._baudRate = 115200;
    this._intentionalDisconnect = false;
    this._reconnecting = false;
    this._reconnectGeneration = 0;
    this._serialListenersBound = false;
  }

  log(msg, cls) {
    this.onLog(msg, cls);
  }

  async ensureProtoLoaded() {
    if (this.root) return;
    this.root = new protobuf.Root();
    await this.root.load(FLIPPER_PROTO_FILES, { keepCase: true });
    this.MainType = this.root.lookupType("PB.Main");
  }

  async connect(baudRate = 115200) {
    await this.ensureProtoLoaded();
    const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: FLIPPER_VID }] });
    this._baudRate = baudRate;
    this._intentionalDisconnect = false;
    this._reconnectGeneration++;
    await port.open({ baudRate });
    this.port = port;
    this.writer = port.writable.getWriter();
    this.reader = port.readable.getReader();
    this.connected = true;
    this.readLoopPromise = this.readLoop();
    this._bindSerialEvents();

    await this._startRpcHandshake();
    this.log("Connected — RPC session started.", "ok");
  }

  async _startRpcHandshake() {
    await this.writeRaw(new TextEncoder().encode("start_rpc_session\r"));
    await new Promise((r) => setTimeout(r, 400));
    if (this.rxBuffer.length) {
      this.log(`Discarding ${this.rxBuffer.length} non-protobuf byte(s) from the RPC handshake.`);
      this.rxBuffer = new Uint8Array(0);
    }
  }

  _bindSerialEvents() {
    if (this._serialListenersBound || !("serial" in navigator)) return;
    this._serialListenersBound = true;
    navigator.serial.addEventListener("disconnect", (evt) => {
      if (evt.target === this.port) this._handleUnexpectedDrop();
    });
    navigator.serial.addEventListener("connect", (evt) => {
      if (evt.target === this.port && this._reconnecting) this._tryReopen();
    });
  }

  _handleUnexpectedDrop() {
    if (!this.connected || this._intentionalDisconnect || this._reconnecting) return;
    this.connected = false;
    this.cliMode = false;
    this.virtualDisplayActive = false;
    this.screenStreamActive = false;
    this.rxBuffer = new Uint8Array(0);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      if (p.reject) p.reject(new Error("Connection lost."));
    }
    this.pending.clear();
    try { this.reader.releaseLock(); } catch (e) {}
    try { this.writer.releaseLock(); } catch (e) {}
    this._reconnecting = true;
    this.log("Connection lost — waiting for the device to come back...", "e");
    this.onConnectionLost();
    this._reconnectLoop(this._reconnectGeneration);
  }

  _reconnectLoop(generation) {
    if (generation !== this._reconnectGeneration || !this._reconnecting) return;
    this._tryReopen().finally(() => {
      setTimeout(() => this._reconnectLoop(generation), 1500);
    });
  }

  async _tryReopen(generation) {
    if (!this._reconnecting || this._intentionalDisconnect) return;
    if (generation !== undefined && generation !== this._reconnectGeneration) return;
    try {
      await this.port.open({ baudRate: this._baudRate });
    } catch (e) {
      return;
    }
    if (!this._reconnecting) {
      try { await this.port.close(); } catch (e) {}
      return;
    }
    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();
    this.connected = true;
    this._reconnecting = false;
    this.readLoopPromise = this.readLoop();
    try {
      await this._startRpcHandshake();
      this.log("Reconnected — RPC session restarted.", "ok");
      this.onReconnected();
    } catch (e) {
      this.log("Reconnected but the RPC handshake failed: " + e.message, "e");
    }
  }

  async readLoop() {
    try {
      while (this.connected) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value || !value.length) continue;
        if (this.cliMode) {
          this.appendCli(value);
        } else {
          this.appendRx(value);
        }
      }
    } catch (e) {
      if (this.connected) this.log("Serial read error: " + e.message, "e");
    }
    if (this.connected && !this._intentionalDisconnect) this._handleUnexpectedDrop();
  }

  appendRx(bytes) {
    const merged = new Uint8Array(this.rxBuffer.length + bytes.length);
    merged.set(this.rxBuffer, 0);
    merged.set(bytes, this.rxBuffer.length);
    this.rxBuffer = merged;
    this.drainMessages();
  }

  drainMessages() {
    while (true) {
      if (this.rxBuffer.length === 0) return;
      const reader = protobuf.Reader.create(this.rxBuffer);
      let msg;
      try {
        msg = this.MainType.decodeDelimited(reader);
      } catch (e) {
        if (this.rxBuffer.length > 65536) {
          this.log(`Dropping ${this.rxBuffer.length} unparseable byte(s) from the read buffer.`, "e");
          this.rxBuffer = new Uint8Array(0);
        }
        return;
      }
      this.rxBuffer = this.rxBuffer.slice(reader.pos);
      this.handleMessage(msg);
    }
  }

  handleMessage(msg) {
    if (msg.gui_screen_frame) {
      if (this.onScreenFrame) this.onScreenFrame(msg.gui_screen_frame.data, msg.gui_screen_frame.orientation);
      return;
    }
    if (msg.desktop_status) {
      if (this.onDesktopStatus) this.onDesktopStatus(msg.desktop_status);
      return;
    }
    const id = msg.command_id;
    const pending = this.pending.get(id);
    if (!pending) return;
    if (pending.collect) {
      pending.collect(msg);
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.resolve(msg);
  }

  async writeRaw(bytes) {
    await this.writer.write(bytes);
  }

  async sendMain(fields, { expectResponse = true, timeoutMs = 6000 } = {}) {
    const id = fields.command_id !== undefined ? fields.command_id : this.nextCommandId++;
    const message = this.MainType.create(Object.assign({ command_id: id, has_next: false }, fields));
    const bytes = this.MainType.encodeDelimited(message).finish();
    if (!expectResponse) {
      await this.writeRaw(bytes);
      return null;
    }
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Timed out waiting for a response from the Flipper."));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    await this.writeRaw(bytes);
    return promise;
  }

  async sendMainCollecting(fields, collectFn, { timeoutMs = 8000, timeoutMsg = "Timed out waiting for a response from the Flipper.", onProgress } = {}) {
    const id = this.nextCommandId++;
    const message = this.MainType.create(Object.assign({ command_id: id, has_next: false }, fields));
    const result = { value: undefined };
    const promise = new Promise((resolve, reject) => {
      const entry = { reject, timer: null, collect: null };
      const arm = () => {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(timeoutMsg));
        }, timeoutMs);
      };
      entry.collect = (msg) => {
        try {
          collectFn(msg, result);
        } catch (err) {
          clearTimeout(entry.timer);
          this.pending.delete(id);
          reject(err);
          return;
        }
        if (onProgress) onProgress(result, msg);
        clearTimeout(entry.timer);
        if (!msg.has_next) {
          this.pending.delete(id);
          resolve(result.value);
        } else {
          arm();
        }
      };
      arm();
      this.pending.set(id, entry);
    });
    await this.writeRaw(this.MainType.encodeDelimited(message).finish());
    return promise;
  }

  async writeFileChunked(path, data, onProgress) {
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const id = this.nextCommandId++;
    const total = Math.ceil(bytes.length / FLIPPER_WRITE_CHUNK_SIZE) || 1;
    let sent = 0;
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Timed out waiting for the Flipper to confirm the write."));
      }, 20000);
      this.pending.set(id, { resolve, reject, timer });
    });
    for (let offset = 0; offset < bytes.length || sent === 0; offset += FLIPPER_WRITE_CHUNK_SIZE) {
      const chunk = bytes.slice(offset, offset + FLIPPER_WRITE_CHUNK_SIZE);
      const hasNext = offset + FLIPPER_WRITE_CHUNK_SIZE < bytes.length;
      const message = this.MainType.create({
        command_id: id,
        has_next: hasNext,
        storage_write_request: { path: path, file: { data: chunk } },
      });
      await this.writeRaw(this.MainType.encodeDelimited(message).finish());
      sent++;
      if (onProgress) onProgress(sent, total);
      if (!hasNext) break;
    }
    const response = await promise;
    if (response.command_status !== 0) {
      throw new Error("Flipper reported an error (status " + response.command_status + ") writing " + path);
    }
    return response;
  }

  async readFileChunked(path, onProgress) {
    return this.sendMainCollecting(
      { storage_read_request: { path: path } },
      (msg, result) => {
        if (msg.command_status !== 0) {
          throw new Error("Flipper reported an error (status " + msg.command_status + ") reading " + path);
        }
        const file = msg.storage_read_response && msg.storage_read_response.file;
        if (!result.chunks) result.chunks = [];
        if (file && file.data && file.data.length) {
          result.chunks.push(file.data);
          result.received = (result.received || 0) + file.data.length;
        }
        if (!msg.has_next) {
          let total = 0;
          for (const c of result.chunks) total += c.length;
          const out = new Uint8Array(total);
          let offset = 0;
          for (const c of result.chunks) { out.set(c, offset); offset += c.length; }
          result.value = out;
        }
      },
      {
        timeoutMs: 20000,
        timeoutMsg: "Timed out waiting for the Flipper to send " + path,
        onProgress: onProgress ? (result) => onProgress(result.received || 0) : undefined,
      }
    );
  }

  async readFileText(path) {
    const bytes = await this.readFileChunked(path);
    return new TextDecoder().decode(bytes);
  }

  async fileExists(path) {
    try {
      const response = await this.sendMain({ storage_stat_request: { path: path } });
      return response.command_status === 0;
    } catch (e) {
      return false;
    }
  }

  async statFile(path) {
    const response = await this.sendMain({ storage_stat_request: { path: path } });
    if (response.command_status !== 0) return null;
    return response.storage_stat_response ? response.storage_stat_response.file : null;
  }

  async listDir(path, { includeMd5 = false, filterMaxSize = 0 } = {}) {
    return this.sendMainCollecting(
      { storage_list_request: { path: path, include_md5: includeMd5, filter_max_size: filterMaxSize } },
      (msg, result) => {
        if (msg.command_status !== 0) {
          throw new Error("Flipper reported an error (status " + msg.command_status + ") listing " + path);
        }
        if (!result.files) result.files = [];
        const chunk = (msg.storage_list_response && msg.storage_list_response.file) || [];
        for (const f of chunk) result.files.push(f);
        if (!msg.has_next) result.value = result.files;
      },
      { timeoutMs: 15000, timeoutMsg: "Timed out waiting for a response from the Flipper." }
    );
  }

  async mkdir(path) {
    const response = await this.sendMain({ storage_mkdir_request: { path: path } });
    if (response.command_status !== 0) {
      throw new Error("Flipper reported an error (status " + response.command_status + ") creating " + path);
    }
    return response;
  }

  async deleteFile(path, recursive = false) {
    const response = await this.sendMain({ storage_delete_request: { path: path, recursive: recursive } });
    if (response.command_status !== 0) {
      throw new Error("Flipper reported an error (status " + response.command_status + ") deleting " + path);
    }
    return response;
  }

  async renameFile(oldPath, newPath) {
    const response = await this.sendMain({ storage_rename_request: { old_path: oldPath, new_path: newPath } });
    if (response.command_status !== 0) {
      throw new Error("Flipper reported an error (status " + response.command_status + ") renaming " + oldPath);
    }
    return response;
  }

  async getStorageInfo(path) {
    const response = await this.sendMain({ storage_info_request: { path: path } });
    if (response.command_status !== 0) return null;
    return response.storage_info_response;
  }

  async getDeviceInfo() {
    return this.sendMainCollecting(
      { system_device_info_request: {} },
      (msg, result) => {
        if (!result.value) result.value = {};
        const kv = msg.system_device_info_response;
        if (kv) result.value[kv.key] = kv.value;
      },
      { timeoutMs: 8000, timeoutMsg: "Timed out waiting for device info." }
    );
  }

  async getPowerInfo() {
    return this.sendMainCollecting(
      { system_power_info_request: {} },
      (msg, result) => {
        if (!result.value) result.value = {};
        const kv = msg.system_power_info_response;
        if (kv) result.value[kv.key] = kv.value;
      },
      { timeoutMs: 8000, timeoutMsg: "Timed out waiting for power info." }
    );
  }

  async getDateTime() {
    const response = await this.sendMain({ system_get_datetime_request: {} });
    if (response.command_status !== 0) return null;
    return response.system_get_datetime_response ? response.system_get_datetime_response.datetime : null;
  }

  async setDateTime(dt) {
    const response = await this.sendMain({ system_set_datetime_request: { datetime: dt } });
    if (response.command_status !== 0) {
      throw new Error("Flipper reported an error (status " + response.command_status + ") setting the clock.");
    }
    return response;
  }

  async reboot(mode = 0) {
    await this.sendMain({ system_reboot_request: { mode: mode } }, { expectResponse: false });
  }

  async ping(data = new Uint8Array(0)) {
    const response = await this.sendMain({ system_ping_request: { data: data } });
    return response.system_ping_response ? response.system_ping_response.data : null;
  }

  async requestReturnToDesktop() {
    try {
      await this.sendMain({ app_exit_request: {} }, { expectResponse: false });
    } catch (e) {   }
  }

  async startVirtualDisplay(frameBytes, sendInput = false) {
    const response = await this.sendMain({
      gui_start_virtual_display_request: { first_frame: { data: frameBytes, orientation: 0 }, send_input: sendInput },
    });
    if (response.command_status !== 0) {
      throw new Error("Flipper rejected virtual display start (status " + response.command_status + ")");
    }
    this.virtualDisplayActive = true;
  }

  async sendFrame(frameBytes) {
    if (!this.connected || !this.virtualDisplayActive) return;
    await this.sendMain({ gui_screen_frame: { data: frameBytes, orientation: 0 } }, { expectResponse: false });
  }

  async stopVirtualDisplay() {
    if (!this.virtualDisplayActive) return;
    try {
      await this.sendMain({ gui_stop_virtual_display_request: {} });
    } catch (e) {
      this.log("Stop virtual display: " + e.message, "w");
    }
    this.virtualDisplayActive = false;
  }

  async startScreenStream() {
    const response = await this.sendMain({ gui_start_screen_stream_request: {} });
    if (response.command_status !== 0) {
      throw new Error("Flipper rejected screen stream start (status " + response.command_status + ")");
    }
    this.screenStreamActive = true;
  }

  async stopScreenStream() {
    if (!this.screenStreamActive) return;
    try {
      await this.sendMain({ gui_stop_screen_stream_request: {} });
    } catch (e) {
      this.log("Stop screen stream: " + e.message, "w");
    }
    this.screenStreamActive = false;
  }

  async sendInputEvent(key, type) {
    await this.sendMain({ gui_send_input_event_request: { key: key, type: type } }, { expectResponse: false });
  }

  async tapInput(key) {
    await this.sendInputEvent(key, 0);
    await this.sendInputEvent(key, 1);
    await this.sendInputEvent(key, 2);
  }

  async enterCliMode() {
    if (this.cliMode) return;
    try {
      await this.sendMain({ stop_session: {} }, { expectResponse: false });
    } catch (e) {   }
    await this.stopScreenStream().catch(() => {});
    this.screenStreamActive = false;
    this.rxBuffer = new Uint8Array(0);
    this.cliLineBuffer = "";
    this.cliMode = true;
    await this.writeRaw(new TextEncoder().encode("\r"));
  }

  async exitCliMode() {
    if (!this.cliMode) return;
    this.cliMode = false;
    await this.writeRaw(new TextEncoder().encode("start_rpc_session\r"));
    await new Promise((r) => setTimeout(r, 400));
    this.rxBuffer = new Uint8Array(0);
  }

  async writeCliText(text) {
    await this.writeRaw(new TextEncoder().encode(text));
  }

  appendCli(bytes) {
    this.cliLineBuffer += new TextDecoder().decode(bytes);
    if (this.cliLineBuffer.length > 8192) this.cliLineBuffer = this.cliLineBuffer.slice(-8192);
    if (this.onCliLine) this.onCliLine(this.cliLineBuffer, bytes);
  }

  async disconnect() {
    this._intentionalDisconnect = true;
    this._reconnecting = false;
    this._reconnectGeneration++;
    if (this.connected) {
      await this.stopScreenStream().catch(() => {});
      await this.stopVirtualDisplay().catch(() => {});
      if (!this.cliMode) {
        try {
          await this.sendMain({ stop_session: {} }, { expectResponse: false });
        } catch (e) {   }
      }
    }
    this.connected = false;
    this.cliMode = false;
    try { await this.reader.cancel(); } catch (e) {}
    try { this.reader.releaseLock(); } catch (e) {}
    try { this.writer.releaseLock(); } catch (e) {}
    try { await this.port.close(); } catch (e) {}
    this.port = null;
    this.rxBuffer = new Uint8Array(0);
    this.log("Disconnected.");
  }
}
