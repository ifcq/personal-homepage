(function (global) {
  "use strict";

  const FLAGS = {
    metadata: 1 << 1,
    newObjectList: 1 << 2,
    rawData: 1 << 3,
    interleaved: 1 << 5,
    bigEndian: 1 << 6,
    daqmx: 1 << 7,
  };

  const TYPES = {
    0x01: { name: "Int8", size: 1, numeric: true },
    0x02: { name: "Int16", size: 2, numeric: true },
    0x03: { name: "Int32", size: 4, numeric: true },
    0x04: { name: "Int64", size: 8, numeric: true },
    0x05: { name: "Uint8", size: 1, numeric: true },
    0x06: { name: "Uint16", size: 2, numeric: true },
    0x07: { name: "Uint32", size: 4, numeric: true },
    0x08: { name: "Uint64", size: 8, numeric: true },
    0x09: { name: "Float32", size: 4, numeric: true },
    0x0a: { name: "Float64", size: 8, numeric: true },
    0x19: { name: "Float32Unit", size: 4, numeric: true },
    0x1a: { name: "Float64Unit", size: 8, numeric: true },
    0x20: { name: "String", size: null, numeric: false },
    0x21: { name: "Boolean", size: 1, numeric: true },
    0x44: { name: "Timestamp", size: 16, numeric: false },
    0x8000c: { name: "ComplexFloat32", size: 8, numeric: false },
    0x10000d: { name: "ComplexFloat64", size: 16, numeric: false },
  };

  class Cursor {
    constructor(view, offset, littleEndian) {
      this.view = view;
      this.offset = offset;
      this.le = littleEndian;
      this.decoder = new TextDecoder("utf-8");
    }
    ensure(bytes) {
      if (this.offset + bytes > this.view.byteLength) throw new Error("TDMS 文件在读取元数据时意外结束");
    }
    u8() { this.ensure(1); const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
    i8() { this.ensure(1); const v = this.view.getInt8(this.offset); this.offset += 1; return v; }
    u16() { this.ensure(2); const v = this.view.getUint16(this.offset, this.le); this.offset += 2; return v; }
    i16() { this.ensure(2); const v = this.view.getInt16(this.offset, this.le); this.offset += 2; return v; }
    u32() { this.ensure(4); const v = this.view.getUint32(this.offset, this.le); this.offset += 4; return v; }
    i32() { this.ensure(4); const v = this.view.getInt32(this.offset, this.le); this.offset += 4; return v; }
    u64() { this.ensure(8); const v = this.view.getBigUint64(this.offset, this.le); this.offset += 8; return v; }
    i64() { this.ensure(8); const v = this.view.getBigInt64(this.offset, this.le); this.offset += 8; return v; }
    f32() { this.ensure(4); const v = this.view.getFloat32(this.offset, this.le); this.offset += 4; return v; }
    f64() { this.ensure(8); const v = this.view.getFloat64(this.offset, this.le); this.offset += 8; return v; }
    string() {
      const length = this.u32();
      this.ensure(length);
      const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length);
      this.offset += length;
      return this.decoder.decode(bytes);
    }
  }

  function safeNumber(big, label) {
    const n = Number(big);
    if (!Number.isSafeInteger(n)) throw new Error(`${label} 超出浏览器可安全读取的范围`);
    return n;
  }

  function readTypedValue(cursor, typeId) {
    switch (typeId) {
      case 0x01: return cursor.i8();
      case 0x02: return cursor.i16();
      case 0x03: return cursor.i32();
      case 0x04: return Number(cursor.i64());
      case 0x05: return cursor.u8();
      case 0x06: return cursor.u16();
      case 0x07: return cursor.u32();
      case 0x08: return Number(cursor.u64());
      case 0x09:
      case 0x19: return cursor.f32();
      case 0x0a:
      case 0x1a: return cursor.f64();
      case 0x20: return cursor.string();
      case 0x21: return cursor.u8() !== 0;
      case 0x44: {
        const fractions = cursor.u64();
        const seconds = cursor.i64();
        const unixSeconds = Number(seconds) - 2082844800 + Number(fractions) / 18446744073709551616;
        return new Date(unixSeconds * 1000).toISOString();
      }
      default: {
        const type = TYPES[typeId];
        if (type?.size) {
          cursor.ensure(type.size);
          cursor.offset += type.size;
          return null;
        }
        throw new Error(`暂不支持 TDMS 属性类型 0x${typeId.toString(16)}`);
      }
    }
  }

  function readNumericAt(view, offset, typeId, littleEndian) {
    switch (typeId) {
      case 0x01: return view.getInt8(offset);
      case 0x02: return view.getInt16(offset, littleEndian);
      case 0x03: return view.getInt32(offset, littleEndian);
      case 0x04: return Number(view.getBigInt64(offset, littleEndian));
      case 0x05: return view.getUint8(offset);
      case 0x06: return view.getUint16(offset, littleEndian);
      case 0x07: return view.getUint32(offset, littleEndian);
      case 0x08: return Number(view.getBigUint64(offset, littleEndian));
      case 0x09:
      case 0x19: return view.getFloat32(offset, littleEndian);
      case 0x0a:
      case 0x1a: return view.getFloat64(offset, littleEndian);
      case 0x21: return view.getUint8(offset) ? 1 : 0;
      default: return NaN;
    }
  }

  function splitPath(path) {
    const names = [];
    const re = /'((?:''|[^'])*)'/g;
    let match;
    while ((match = re.exec(path))) names.push(match[1].replace(/''/g, "'"));
    return { group: names[0] || "", channel: names[1] || "" };
  }

  function cloneObject(obj) {
    return {
      path: obj.path,
      hasData: obj.hasData,
      typeId: obj.typeId,
      type: obj.type,
      numberValues: obj.numberValues,
      dataSize: obj.dataSize,
    };
  }

  function parseTdms(arrayBuffer, fileName) {
    const view = new DataView(arrayBuffer);
    const decoder = new TextDecoder("ascii");
    const channelChunks = new Map();
    const properties = new Map();
    const warnings = [];
    const previousByPath = new Map();
    let previousOrdered = null;
    let position = 0;
    let segmentCount = 0;

    while (position + 28 <= view.byteLength) {
      const tag = decoder.decode(new Uint8Array(arrayBuffer, position, 4));
      if (tag !== "TDSm") throw new Error(`不是有效的 TDMS 文件（位置 ${position} 未找到 TDSm 标记）`);

      const toc = view.getUint32(position + 4, true);
      const littleEndian = (toc & FLAGS.bigEndian) === 0;
      const version = view.getUint32(position + 8, littleEndian);
      if (version !== 4712 && version !== 4713) warnings.push(`检测到 TDMS 版本 ${version}`);
      if (toc & FLAGS.daqmx) throw new Error("暂不支持 DAQmx 原始缩放数据；请先在 NI/LabVIEW 中导出为普通数值通道");

      const nextOffsetBig = view.getBigUint64(position + 12, littleEndian);
      const rawOffset = safeNumber(view.getBigUint64(position + 20, littleEndian), "原始数据偏移");
      const segmentEnd = nextOffsetBig === 0xffffffffffffffffn
        ? view.byteLength
        : position + 28 + safeNumber(nextOffsetBig, "分段长度");
      const rawStart = position + 28 + rawOffset;
      if (segmentEnd > view.byteLength || rawStart > segmentEnd) throw new Error("TDMS 分段长度无效或文件不完整");

      let ordered;
      if (toc & FLAGS.metadata) {
        const cursor = new Cursor(view, position + 28, littleEndian);
        const newList = (toc & FLAGS.newObjectList) !== 0 || !previousOrdered;
        ordered = newList ? [] : previousOrdered.map(cloneObject);
        const existing = new Map(ordered.map((obj, index) => [obj.path, index]));
        const objectCount = cursor.u32();

        for (let i = 0; i < objectCount; i += 1) {
          const path = cursor.string();
          const indexHeader = cursor.u32();
          let obj;
          let existingIndex = existing.get(path);
          if (existingIndex !== undefined) obj = cloneObject(ordered[existingIndex]);
          else if (previousByPath.has(path)) obj = cloneObject(previousByPath.get(path));
          else obj = { path, hasData: false, typeId: null, type: null, numberValues: 0, dataSize: 0 };

          if (indexHeader === 0xffffffff) {
            obj.hasData = false;
          } else if (indexHeader === 0) {
            if (!obj.type) throw new Error(`通道 ${path} 要求复用尚不存在的数据结构`);
            obj.hasData = true;
          } else {
            obj.hasData = true;
            obj.typeId = cursor.u32();
            const dimension = cursor.u32();
            obj.numberValues = safeNumber(cursor.u64(), "通道采样数");
            obj.type = TYPES[obj.typeId];
            if (dimension !== 1) throw new Error("仅支持一维 TDMS 通道");
            if (!obj.type) throw new Error(`暂不支持 TDMS 数据类型 0x${obj.typeId.toString(16)}`);
            obj.dataSize = obj.typeId === 0x20
              ? safeNumber(cursor.u64(), "字符串数据长度")
              : (obj.type.size || 0) * obj.numberValues;
            // The index header length includes the four-byte header itself.
            const consumedAfterHeader = obj.typeId === 0x20 ? 24 : 16;
            const extraIndexBytes = indexHeader - 4 - consumedAfterHeader;
            if (extraIndexBytes > 0) cursor.offset += extraIndexBytes;
          }

          const propertyCount = cursor.u32();
          const propTarget = { ...(properties.get(path) || {}) };
          for (let p = 0; p < propertyCount; p += 1) {
            const name = cursor.string();
            const typeId = cursor.u32();
            propTarget[name] = readTypedValue(cursor, typeId);
          }
          properties.set(path, propTarget);

          if (existingIndex === undefined) {
            ordered.push(obj);
            existing.set(path, ordered.length - 1);
          } else {
            ordered[existingIndex] = obj;
          }
          previousByPath.set(path, cloneObject(obj));
        }
      } else {
        if (!previousOrdered) throw new Error("TDMS 首个分段缺少元数据");
        ordered = previousOrdered.map(cloneObject);
      }

      if (toc & FLAGS.rawData) {
        const dataObjects = ordered.filter((obj) => obj.hasData && splitPath(obj.path).channel);
        const numericObjects = dataObjects.filter((obj) => obj.type?.numeric);
        for (const obj of dataObjects) {
          if (!obj.type?.numeric && !warnings.includes(`已忽略非数值通道：${obj.path}`)) warnings.push(`已忽略非数值通道：${obj.path}`);
        }

        if (toc & FLAGS.interleaved) {
          if (numericObjects.length !== dataObjects.length) throw new Error("交错数据中包含暂不支持的非数值通道");
          const rowWidth = dataObjects.reduce((sum, obj) => sum + obj.type.size, 0);
          if (rowWidth > 0) {
            const rows = Math.floor((segmentEnd - rawStart) / rowWidth);
            const arrays = new Map(numericObjects.map((obj) => [obj.path, new Float64Array(rows)]));
            let offset = rawStart;
            for (let row = 0; row < rows; row += 1) {
              for (const obj of dataObjects) {
                arrays.get(obj.path)[row] = readNumericAt(view, offset, obj.typeId, littleEndian);
                offset += obj.type.size;
              }
            }
            for (const obj of numericObjects) {
              if (!channelChunks.has(obj.path)) channelChunks.set(obj.path, []);
              channelChunks.get(obj.path).push(arrays.get(obj.path));
            }
          }
        } else {
          const chunkSize = dataObjects.reduce((sum, obj) => sum + obj.dataSize, 0);
          let offset = rawStart;
          while (chunkSize > 0 && offset < segmentEnd) {
            for (const obj of dataObjects) {
              const available = Math.max(0, segmentEnd - offset);
              const count = obj.type?.size ? Math.min(obj.numberValues, Math.floor(available / obj.type.size)) : 0;
              if (obj.type?.numeric) {
                const values = new Float64Array(count);
                for (let j = 0; j < count; j += 1) values[j] = readNumericAt(view, offset + j * obj.type.size, obj.typeId, littleEndian);
                if (!channelChunks.has(obj.path)) channelChunks.set(obj.path, []);
                channelChunks.get(obj.path).push(values);
              }
              offset += obj.typeId === 0x20 ? Math.min(obj.dataSize, available) : count * (obj.type?.size || 0);
              if (offset >= segmentEnd) break;
            }
            if (segmentEnd - offset < chunkSize) {
              if (offset < segmentEnd) warnings.push("文件末尾包含不完整的数据块，已读取其中完整的数值");
              break;
            }
          }
        }
      }

      previousOrdered = ordered;
      segmentCount += 1;
      if (segmentEnd <= position) throw new Error("TDMS 分段偏移无效");
      position = segmentEnd;
    }

    const channels = [];
    for (const [path, chunks] of channelChunks.entries()) {
      const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const data = new Float64Array(length);
      let writeAt = 0;
      for (const chunk of chunks) { data.set(chunk, writeAt); writeAt += chunk.length; }
      const names = splitPath(path);
      const source = previousByPath.get(path);
      channels.push({
        id: path,
        name: names.channel,
        group: names.group,
        data,
        typeName: source?.type?.name || "Numeric",
        properties: properties.get(path) || {},
      });
    }

    if (!channels.length) throw new Error("文件中没有可绘制的数值通道");
    return {
      fileName,
      channels,
      fileProperties: properties.get("/") || {},
      sampleCount: Math.max(...channels.map((channel) => channel.data.length)),
      segmentCount,
      warnings,
    };
  }

  global.TdmsParser = { parse: parseTdms };
})(window);
