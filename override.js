function readVarint(dataView, offset) {
    let value = 0, shift = 0, byte = 0;
    do {
        byte = dataView.getUint8(offset++);
        value |= (byte & 0x7F) << shift;
        shift += 7;
    } while (byte & 0x80);
    return { value, offset };
}


function readNumericArray(dataView, offset, length, type) {
    let arr;
    let rawLength;
    switch (type) {
        case 0: // int8
            arr = new Int8Array(dataView.buffer, offset, length);
            rawLength = length;
            break;
        
        case 16:
            arr = new Uint8Array(dataView.buffer, offset, length);
            rawLength = length;
            break;
        
        case 1: // int16
            arr = new Int16Array(dataView.buffer.slice(offset), 0, length);
            rawLength = length * 2;
            break;
        
        case 17:
            arr = new Uint16Array(dataView.buffer.slice(offset), 0, length);
            rawLength = length * 2;
            break;
        
         case 2: // 
            arr = new Int32Array(dataView.buffer.slice(offset), 0, length);
            rawLength = length * 4;
            break;
        
        case 18:
            arr = new Uint32Array(dataView.buffer.slice(offset), 0, length);
            rawLength = length * 4;
            break; 
        
        case 3: // 
            arr = new Int64Array(dataView.buffer.slice(offset), 0, length);
            rawLength = length * 8;
            break;
        
        case 19:
            arr = new Uint64Array(dataView.buffer.slice(offset), 0, length);
            rawLength = length * 8;
            break;        
        
        case 34:
            arr = new Float32Array(dataView.buffer.slice(offset), 0, length);
            rawLength = length * 4;        
            break;
        
        case 35:
            arr = new Float64Array(dataView.buffer.slice(offset), 0, length);
            rawLength = length * 8;
            //console.log(length);
            break;
        default:
            throw new Error(`Unsupported numeric array type: ${type}`);
    }
    return {array: arr, length: rawLength};
}

function readString(dataView, offset, length) {
    let decoder = new TextDecoder("utf-8");
    let bytes = new Uint8Array(dataView.buffer, offset, length);
    return decoder.decode(bytes);
}

function deserializeWXF(buffer) {
    let dataView = new DataView(buffer);
    let offset = 0;

    // Parse the WXF version header
    if (dataView.getUint8(offset++) !== 56 || dataView.getUint8(offset++) !== 58) {
        throw new Error("Invalid WXF header.");
    }
    
    //console.log("WXF version header recognized.");

    function parseWXF(opts = {}) {
        if (offset >= dataView.byteLength) {
          throw new Error("Unexpected end of buffer.");
        }

        let token = dataView.getUint8(offset++);
        //console.log(`Processing token: ${token}`);

        switch (token) {
            case 102: { // "f" - function
                let { value: length, offset: newOffset } = readVarint(dataView, offset);
                offset = newOffset;
                let head = parseWXF();
                let args = [];
              
                //optimizations for numerical Lists
                if (head == "List") {
                  for (let i = 0; i < length; i++) {
                      args.push(parseWXF({...opts, listQ: true}));
                  }
                  
                  if (opts.listQ) return args;
                  return ['JSObject', args];   
                  
                }
              
                for (let i = 0; i < length; i++) {
                  args.push(parseWXF(opts));
                }                 
                
                return [head, ...args];
                
            }
            case 67: { // "C" - signed 8-bit integer
                return dataView.getInt8(offset++);
            }
            case 106: { // "j" - signed 16-bit integer
                let value = dataView.getInt16(offset, true);
                offset += 2;
                return value;
            }
            case 105: { // "i" - signed 32-bit integer
                let value = dataView.getInt32(offset, true);
                offset += 4;
                return value;
            }
            case 114: { // "r" - IEEE double-precision real
                let value = dataView.getFloat64(offset, true);
                offset += 8;
                return value;
            }
            case 83: { // "S" - string
                let { value: length, offset: newOffset } = readVarint(dataView, offset);
                offset = newOffset;
                let str = readString(dataView, offset, length);
                offset += length;
                return "'"+str+"'";
            }
            case 193: // "Á" - packed array
            case 194: { // "Â" - numeric array
                let arrayType = dataView.getUint8(offset++);
                let rank = dataView.getUint8(offset++);
                let dims = [];
                let length = 1;
                for (let i=0; i<rank; ++i) {
                  let { value: len, offset: newOffset } =readVarint(dataView, offset)
                  //const len = dataView.getUint8(offset++);
                  offset = newOffset;
                  
                  length *= len;
                  dims.push(len);
                }
                //let { value: length, offset: newOffset } = readVarint(dataView, offset);
                //console.log({value: length, offset: length, dims: dims});
                //offset = newOffset;
                let array = readNumericArray(dataView, offset, length, arrayType);
                offset += array.length;
                return ['JSObject', new NumericArrayObject(array.array, dims)];
            }
            case 65: { // "A" - association
                let assoc = {};
                let { value: length, offset: newOffset } = readVarint(dataView, offset);
                offset = newOffset;
                for (let i = 0; i < length; i++) {
                    let key = parseWXF();
                    let value = parseWXF();
                    assoc[key] = value;
                }
                return ['JSObject', assoc];
            }
            case 67: { // "C" - signed 8-bit integer
                return dataView.getInt8(offset++);
            }
            case 115: { // "s" - symbol
                let { value: length, offset: newOffset } = readVarint(dataView, offset);
                offset = newOffset;
                let symbol = readString(dataView, offset, length);
                offset += length;
                // Return as a symbol object or just the string for now
                return symbol;
            }
            default:
                throw new Error(`Unknown token: ${token} at offset ${offset - 1}`);
        }
    }

    try {
        return parseWXF();
    } catch (error) {
        console.error(`Deserialization error: ${error.message}`);
        throw error;
    }
}

interpretate.handleMessage = (event) => {
    const uid = Math.floor(Math.random() * 100);
    const global = {call: uid};
    if (event.data instanceof ArrayBuffer) {
        //console.warn('Captured binary frame!');
        const parsed = deserializeWXF(event.data);
        //console.log(parsed);
        interpretate(parsed, {global: global});
    } else {
        //console.warn('Captured text frame!');
        interpretate(JSON.parse(event.data), {global: global});
    }
}


